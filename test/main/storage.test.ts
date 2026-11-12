import { describe, expect, it } from 'vitest';
import { isAllowedLink, isRequest } from '../../src/main/guards';
import {
  loadState,
  parseCredentials,
  parsePending,
  parsePreferences,
  parseRecent,
  PENDING_LIMIT,
  PENDING_MAX_AGE_MS,
  RECENT_LIMIT,
  saveCredentials,
  savePending,
  STORAGE_KEYS,
} from '../../src/main/storage';
import { FakeStorage } from './fake-figma';

describe('parseCredentials', () => {
  it('keeps a trimmed key and an optional secret', () => {
    expect(parseCredentials({ apiKey: ' key ' })).toEqual({ apiKey: 'key' });
    expect(parseCredentials({ apiKey: 'key', apiSecret: ' secret ' })).toEqual({ apiKey: 'key', apiSecret: 'secret' });
    expect(parseCredentials({ apiKey: 'key', apiSecret: '  ' })).toEqual({ apiKey: 'key' });
  });

  it('rejects anything without a key', () => {
    for (const value of [null, undefined, 'key', [], {}, { apiKey: '' }, { apiKey: 42 }, { apiKey: 'x'.repeat(600) }]) {
      expect(parseCredentials(value)).toBeNull();
    }
  });
});

describe('parsePreferences', () => {
  it('keeps models per action, options, the tab and per-model values', () => {
    expect(
      parsePreferences({
        models: { generate: 'google/nano-banana-2', edit: 'not a slug', 'any-upscale': 'xinntao/real-esrgan' },
        options: { 'translate-preset': 'turkish', 'Bad Key': 'x' },
        tab: 'edit',
        scaleMode: 'FIT',
        values: { 'openai/gpt-image-2': { quality: 'high', samples: 2 } },
        extra: true,
      }),
    ).toEqual({
      models: { generate: 'google/nano-banana-2', 'any-upscale': 'xinntao/real-esrgan' },
      options: { 'translate-preset': 'turkish' },
      tab: 'edit',
      scaleMode: 'FIT',
      values: { 'openai/gpt-image-2': { quality: 'high' } },
    });
  });

  it('moves the single model of version 1 to the image action', () => {
    expect(parsePreferences({ model: 'pruna/p-image' })).toEqual({ models: { generate: 'pruna/p-image' } });
    expect(parsePreferences({ model: 'pruna/p-image', models: { generate: 'openai/gpt-image-2' } })).toEqual({
      models: { generate: 'openai/gpt-image-2' },
    });
  });

  it('ignores junk', () => {
    expect(parsePreferences({ scaleMode: 'TILE', tab: 'Not A Tab!' })).toEqual({});
    expect(parsePreferences('nope')).toEqual({});
  });
});

describe('parseRecent', () => {
  const good = { url: 'https://cdn1.wiro.ai/a/0.png', model: 'm/x', prompt: 'p', createdAt: 1 };

  it('keeps well-formed https entries, at most RECENT_LIMIT', () => {
    const list = Array.from({ length: RECENT_LIMIT + 5 }, (_, index) => ({ ...good, url: `${good.url}?${index}` }));
    expect(parseRecent(list)).toHaveLength(RECENT_LIMIT);
  });

  it('drops entries with a bad url or missing fields', () => {
    expect(
      parseRecent([
        good,
        { ...good, url: 'http://cdn1.wiro.ai/a.png' },
        { ...good, url: 'javascript:alert(1)' },
        { ...good, model: undefined },
        { ...good, createdAt: 'yesterday' },
        'junk',
      ]),
    ).toEqual([good]);
  });

  it('keeps vectors and optional fields, and cuts long prompts instead of dropping them', () => {
    const long = 'x'.repeat(10_000);
    expect(
      parseRecent([{ ...good, kind: 'svg', taskId: '7', width: 10, height: 20, costUsd: 0.04, prompt: long }]),
    ).toEqual([{ ...good, kind: 'svg', taskId: '7', width: 10, height: 20, costUsd: 0.04, prompt: 'x'.repeat(4000) }]);
  });
});

describe('parsePending', () => {
  const now = 10 * PENDING_MAX_AGE_MS;
  const run = { tasktoken: 'tok', model: 'm/x', prompt: 'p', startedAt: now - 1000 };

  it('keeps recent runs, newest first, without repeats, at most PENDING_LIMIT', () => {
    expect(parsePending([run, { ...run, tasktoken: 'two' }, run], now)).toEqual([run, { ...run, tasktoken: 'two' }]);
    const many = Array.from({ length: PENDING_LIMIT + 3 }, (_, index) => ({ ...run, tasktoken: `t${index}` }));
    expect(parsePending(many, now)).toHaveLength(PENDING_LIMIT);
  });

  it('reads the single run of version 1', () => {
    expect(parsePending(run, now)).toEqual([run]);
  });

  it('forgets runs older than a day and malformed ones, and keeps long prompts cut', () => {
    expect(parsePending([{ ...run, startedAt: now - PENDING_MAX_AGE_MS - 1 }], now)).toEqual([]);
    expect(parsePending([{ ...run, tasktoken: '' }], now)).toEqual([]);
    expect(parsePending(null, now)).toEqual([]);
    expect(parsePending([{ ...run, prompt: 'y'.repeat(9000) }], now)[0]!.prompt).toHaveLength(4000);
  });
});

describe('storage round trip', () => {
  it('saves checked values and loads them back', async () => {
    const storage = new FakeStorage();
    await saveCredentials(storage, { apiKey: ' k ', apiSecret: 's', other: 'x' });
    expect(storage.data.get(STORAGE_KEYS.credentials)).toEqual({ apiKey: 'k', apiSecret: 's' });
    await savePending(storage, [{ tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 }], 10);
    const state = await loadState(storage, 10);
    expect(state.credentials).toEqual({ apiKey: 'k', apiSecret: 's' });
    expect(state.pending).toEqual([{ tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 }]);
    expect(state.preferences).toEqual({});
    expect(state.recent).toEqual([]);
  });

  it('removes the key when nothing valid is left', async () => {
    const storage = new FakeStorage();
    await saveCredentials(storage, { apiKey: 'k' });
    await saveCredentials(storage, { apiKey: '' });
    expect(storage.data.has(STORAGE_KEYS.credentials)).toBe(false);
    await savePending(storage, [{ tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 }], 10);
    await savePending(storage, [], 10);
    expect(storage.data.has(STORAGE_KEYS.pending)).toBe(false);
  });
});

describe('guards', () => {
  it('opens only wiro.ai pages and Wiro AI result files', () => {
    expect(isAllowedLink('https://wiro.ai')).toBe(true);
    expect(isAllowedLink('https://wiro.ai/panel/billing')).toBe(true);
    expect(isAllowedLink('https://cdn1.wiro.ai/abc/output.mp4')).toBe(true);
    for (const url of [
      'http://wiro.ai',
      'https://wiro.ai.example.com',
      'https://evil.com/?https://wiro.ai',
      'https://cdn1.wiro.ai/',
      'javascript:alert(1)',
      42,
    ]) {
      expect(isAllowedLink(url)).toBe(false);
    }
  });

  const image = { bytes: new Uint8Array([1]), width: 1, height: 1, url: 'https://cdn1.wiro.ai/a.png' };
  const place = {
    kind: 'place',
    images: [image],
    targetIds: ['1:2'],
    mode: 'fill',
    scaleMode: 'FILL',
    name: 'n',
    model: 'm/x',
  };

  it('checks place requests', () => {
    expect(isRequest(place)).toBe(true);
    expect(isRequest({ ...place, mode: 'beside', anchorId: '1:2', targetIds: [] })).toBe(true);
    expect(isRequest({ ...place, images: [] })).toBe(false);
    expect(isRequest({ ...place, images: [{ ...image, bytes: [1] }] })).toBe(false);
    expect(isRequest({ ...place, mode: 'stack' })).toBe(false);
    expect(isRequest({ ...place, scaleMode: 'TILE' })).toBe(false);
    expect(isRequest({ ...place, targetIds: Array.from({ length: 501 }, (_, index) => String(index)) })).toBe(false);
  });

  it('checks the other requests', () => {
    expect(isRequest({ kind: 'export', maxSide: 2048, limit: 2 })).toBe(true);
    expect(isRequest({ kind: 'export', maxSide: 10_000, limit: 2 })).toBe(false);
    expect(isRequest({ kind: 'read-text', limit: 50 })).toBe(true);
    expect(isRequest({ kind: 'set-text', items: [{ id: '1:1', text: 'Hi' }] })).toBe(true);
    expect(isRequest({ kind: 'set-text', items: [] })).toBe(false);
    expect(isRequest({ kind: 'place-svg', svg: '<svg/>', name: 'n', model: 'm/x' })).toBe(true);
    expect(isRequest({ kind: 'place-svg', svg: '', name: 'n', model: 'm/x' })).toBe(false);
    expect(isRequest({ kind: 'insert-text', text: 'Hello', name: 'n' })).toBe(true);
    expect(isRequest({ kind: 'delete-everything' })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });
});

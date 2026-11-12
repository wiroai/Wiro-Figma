import { describe, expect, it } from 'vitest';
import { isAllowedLink, isPlaceRequest } from '../../src/main/guards';
import {
  loadState,
  parseCredentials,
  parsePending,
  parsePreferences,
  parseRecent,
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
  it('keeps valid fields and drops the rest', () => {
    expect(
      parsePreferences({
        model: 'google/nano-banana-2',
        scaleMode: 'FIT',
        values: { 'openai/gpt-image-2': { quality: 'high', samples: 2 } },
        extra: true,
      }),
    ).toEqual({
      model: 'google/nano-banana-2',
      scaleMode: 'FIT',
      values: { 'openai/gpt-image-2': { quality: 'high' } },
    });
  });

  it('ignores a model that is not owner/slug and an unknown scale mode', () => {
    expect(parsePreferences({ model: 'not a slug', scaleMode: 'TILE' })).toEqual({});
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

  it('keeps the optional fields when they are valid', () => {
    expect(parseRecent([{ ...good, taskId: '7', width: 10, height: 20, costUsd: 0.04 }])).toEqual([
      { ...good, taskId: '7', width: 10, height: 20, costUsd: 0.04 },
    ]);
  });
});

describe('parsePending', () => {
  const now = 10 * PENDING_MAX_AGE_MS;
  const pending = { tasktoken: 'tok', model: 'm/x', prompt: 'p', startedAt: now - 1000 };

  it('keeps a recent run', () => {
    expect(parsePending(pending, now)).toEqual(pending);
  });

  it('forgets a run older than a day, or a malformed one', () => {
    expect(parsePending({ ...pending, startedAt: now - PENDING_MAX_AGE_MS - 1 }, now)).toBeNull();
    expect(parsePending({ ...pending, tasktoken: '' }, now)).toBeNull();
    expect(parsePending(null, now)).toBeNull();
  });
});

describe('storage round trip', () => {
  it('saves checked values and loads them back', async () => {
    const storage = new FakeStorage();
    await saveCredentials(storage, { apiKey: ' k ', apiSecret: 's', other: 'x' });
    expect(storage.data.get(STORAGE_KEYS.credentials)).toEqual({ apiKey: 'k', apiSecret: 's' });
    await savePending(storage, { tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 }, 10);
    const state = await loadState(storage, 10);
    expect(state.credentials).toEqual({ apiKey: 'k', apiSecret: 's' });
    expect(state.pending).toEqual({ tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 });
    expect(state.preferences).toEqual({});
    expect(state.recent).toEqual([]);
  });

  it('removes the key when the value is invalid', async () => {
    const storage = new FakeStorage();
    await saveCredentials(storage, { apiKey: 'k' });
    await saveCredentials(storage, { apiKey: '' });
    expect(storage.data.has(STORAGE_KEYS.credentials)).toBe(false);
    await savePending(storage, { tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: 5 }, 10);
    await savePending(storage, null, 10);
    expect(storage.data.has(STORAGE_KEYS.pending)).toBe(false);
  });
});

describe('guards', () => {
  it('opens only wiro.ai pages', () => {
    expect(isAllowedLink('https://wiro.ai')).toBe(true);
    expect(isAllowedLink('https://wiro.ai/panel/billing')).toBe(true);
    for (const url of [
      'http://wiro.ai',
      'https://wiro.ai.example.com',
      'https://evil.com/?https://wiro.ai',
      'javascript:alert(1)',
      42,
    ]) {
      expect(isAllowedLink(url)).toBe(false);
    }
  });

  it('checks place requests', () => {
    const valid = {
      type: 'place',
      requestId: 1,
      images: [{ bytes: new Uint8Array([1]), width: 1, height: 1, url: 'https://cdn1.wiro.ai/a.png' }],
      targetIds: ['1:2'],
      scaleMode: 'FILL',
      name: 'n',
      model: 'm/x',
    };
    expect(isPlaceRequest(valid)).toBe(true);
    expect(isPlaceRequest({ ...valid, images: [] })).toBe(false);
    expect(isPlaceRequest({ ...valid, images: [{ ...valid.images[0], bytes: [1] }] })).toBe(false);
    expect(isPlaceRequest({ ...valid, scaleMode: 'TILE' })).toBe(false);
    expect(isPlaceRequest({ ...valid, targetIds: [1] })).toBe(false);
    expect(isPlaceRequest(null)).toBe(false);
  });
});

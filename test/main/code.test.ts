import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainToUi } from '../../src/shared/messages';
import { fakeFigma, fakeNode } from './fake-figma';

// Loads the real main thread (src/code.ts) against the fake plugin API and
// talks to it the way the UI does.

type Fake = ReturnType<typeof fakeFigma>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function start(fake: Fake) {
  vi.stubGlobal('figma', fake.figma);
  vi.stubGlobal('__html__', '<div id="app"></div>');
  vi.resetModules();
  await import('../../src/code');
  return async (message: unknown) => {
    fake.figma.ui.onmessage!(message);
    for (let index = 0; index < 4; index += 1) await flush();
  };
}

function lastPosted(fake: Fake): MainToUi {
  return fake.posted[fake.posted.length - 1] as MainToUi;
}

const image = { bytes: new Uint8Array([9]), width: 10, height: 10, url: 'https://cdn1.wiro.ai/a.png' };

describe('main thread', () => {
  let fake: Fake;
  beforeEach(() => {
    fake = fakeFigma();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the UI with Figma theme colours and follows the selection', async () => {
    await start(fake);
    expect(fake.showUIOptions).toMatchObject({ themeColors: true, width: 380, height: 680 });
    expect(Object.keys(fake.handlers).sort()).toEqual(['currentpagechange', 'selectionchange']);
    const frame = fakeNode('FRAME', { name: 'Hero', width: 800, height: 600 });
    fake.page.selection = [frame];
    fake.handlers.selectionchange![0]!();
    expect(lastPosted(fake)).toEqual({
      type: 'selection',
      selection: {
        targets: [{ id: frame.id, name: 'Hero', type: 'FRAME', width: 800, height: 600, hasImage: false }],
        skipped: 0,
        texts: 0,
      },
    });
  });

  it('answers ready with what it keeps, and saves only checked values', async () => {
    const send = await start(fake);
    await send({ type: 'save-credentials', credentials: { apiKey: ' key ', injected: true } });
    await send({
      type: 'save-preferences',
      preferences: { models: { generate: 'openai/gpt-image-2' }, scaleMode: 'FIT' },
    });
    await send({
      type: 'save-pending',
      pending: [{ tasktoken: 't', model: 'm/x', prompt: 'p', startedAt: Date.now() }],
    });
    await send({ type: 'ready' });
    expect(lastPosted(fake)).toMatchObject({
      type: 'init',
      credentials: { apiKey: 'key' },
      preferences: { models: { generate: 'openai/gpt-image-2' }, scaleMode: 'FIT' },
      recent: [],
      pending: [{ tasktoken: 't', model: 'm/x', prompt: 'p' }],
      selection: { targets: [], skipped: 0, texts: 0 },
    });
    await send({ type: 'clear-credentials' });
    await send({ type: 'ready' });
    expect((lastPosted(fake) as { credentials: unknown }).credentials).toBeNull();
  });

  it('answers a place request with the result and tells the user', async () => {
    const frame = fakeNode('FRAME');
    fake = fakeFigma([frame]);
    const send = await start(fake);
    await send({
      type: 'request',
      requestId: 7,
      request: {
        kind: 'place',
        images: [image],
        targetIds: [frame.id],
        mode: 'fill',
        scaleMode: 'FILL',
        name: 'p',
        model: 'm/x',
      },
    });
    expect(lastPosted(fake)).toEqual({ type: 'reply', requestId: 7, result: { filled: 1, created: 0, missing: 0 } });
    expect(fake.notifications).toEqual([{ message: 'Filled 1 layer', error: false }]);
  });

  it('exports the selection and reads and writes its text', async () => {
    const title = fakeNode('TEXT', { name: 'Title', characters: 'Old' });
    const card = fakeNode('FRAME', { name: 'Card', width: 300, height: 200 });
    card.appendChild!(title);
    fake = fakeFigma([card]);
    fake.page.selection = [card];
    const send = await start(fake);
    await send({ type: 'request', requestId: 1, request: { kind: 'export', maxSide: 2048, limit: 1 } });
    const exported = lastPosted(fake) as { result: Array<{ name: string; source: string; width: number }> };
    expect(exported.result.map((item) => [item.name, item.source, item.width])).toEqual([['Card', 'render', 600]]);
    await send({ type: 'request', requestId: 2, request: { kind: 'read-text', limit: 10 } });
    expect(lastPosted(fake)).toEqual({
      type: 'reply',
      requestId: 2,
      result: [{ id: title.id, name: 'Title', characters: 'Old' }],
    });
    await send({
      type: 'request',
      requestId: 3,
      request: { kind: 'set-text', items: [{ id: title.id, text: 'New' }] },
    });
    expect(lastPosted(fake)).toEqual({ type: 'reply', requestId: 3, result: { updated: 1, failed: [] } });
    expect(title.characters).toBe('New');
  });

  it('adds vectors and text layers', async () => {
    const send = await start(fake);
    await send({
      type: 'request',
      requestId: 4,
      request: { kind: 'place-svg', svg: '<svg width="256" height="256"></svg>', name: 'Icon', model: 'm/x' },
    });
    expect(lastPosted(fake)).toEqual({ type: 'reply', requestId: 4, result: { created: 1 } });
    await send({ type: 'request', requestId: 5, request: { kind: 'insert-text', text: 'Hello', name: 'Answer' } });
    expect(lastPosted(fake)).toEqual({ type: 'reply', requestId: 5, result: { created: 1 } });
    expect(fake.page.children.map((node) => node.type)).toEqual(['FRAME', 'TEXT']);
  });

  it('answers a failed or malformed request with an error, so the UI never waits', async () => {
    const send = await start(fake);
    await send({
      type: 'request',
      requestId: 8,
      request: {
        kind: 'place',
        images: [image],
        targetIds: ['gone:1'],
        mode: 'fill',
        scaleMode: 'FILL',
        name: 'p',
        model: 'm/x',
      },
    });
    const failed = lastPosted(fake) as { type: string; requestId: number; error?: string };
    expect(failed).toMatchObject({ type: 'reply', requestId: 8 });
    expect(failed.error).toMatch(/gone/);
    await send({ type: 'request', requestId: 9, request: { kind: 'place', images: 'nope' } });
    expect(lastPosted(fake)).toEqual({
      type: 'reply',
      requestId: 9,
      error: 'The plugin sent a request it could not read.',
    });
  });

  it('opens only allowed links', async () => {
    const send = await start(fake);
    await send({ type: 'open-url', url: 'https://example.com' });
    await send({ type: 'open-url', url: 'https://wiro.ai/panel/billing' });
    expect(fake.opened).toEqual(['https://wiro.ai/panel/billing']);
  });
});

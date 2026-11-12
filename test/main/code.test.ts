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
    await flush();
    await flush();
  };
}

function lastPosted(fake: Fake): MainToUi {
  return fake.posted[fake.posted.length - 1] as MainToUi;
}

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
    expect(fake.showUIOptions).toMatchObject({ themeColors: true, width: 360, height: 640 });
    expect(Object.keys(fake.handlers).sort()).toEqual(['currentpagechange', 'selectionchange']);
    const frame = fakeNode('FRAME', { name: 'Hero', width: 800, height: 600 });
    fake.page.selection = [frame];
    fake.handlers.selectionchange![0]!();
    expect(lastPosted(fake)).toEqual({
      type: 'selection',
      selection: { targets: [{ id: frame.id, name: 'Hero', type: 'FRAME', width: 800, height: 600 }], skipped: 0 },
    });
  });

  it('answers ready with what it keeps, and saves only checked values', async () => {
    const send = await start(fake);
    await send({ type: 'save-credentials', credentials: { apiKey: ' key ', injected: true } });
    await send({ type: 'save-preferences', preferences: { model: 'openai/gpt-image-2', scaleMode: 'FIT' } });
    await send({ type: 'ready' });
    expect(lastPosted(fake)).toEqual({
      type: 'init',
      credentials: { apiKey: 'key' },
      preferences: { model: 'openai/gpt-image-2', scaleMode: 'FIT' },
      recent: [],
      pending: null,
      selection: { targets: [], skipped: 0 },
    });
    await send({ type: 'clear-credentials' });
    await send({ type: 'ready' });
    expect((lastPosted(fake) as { credentials: unknown }).credentials).toBeNull();
  });

  it('places images and tells both the UI and the user', async () => {
    const frame = fakeNode('FRAME');
    fake = fakeFigma([frame]);
    const send = await start(fake);
    await send({
      type: 'place',
      requestId: 7,
      images: [{ bytes: new Uint8Array([9]), width: 10, height: 10, url: 'https://cdn1.wiro.ai/a.png' }],
      targetIds: [frame.id],
      scaleMode: 'FILL',
      name: 'prompt',
      model: 'm/x',
    });
    expect(lastPosted(fake)).toEqual({ type: 'placed', requestId: 7, result: { filled: 1, created: 0, missing: 0 } });
    expect(fake.notifications).toEqual([{ message: 'Filled 1 layer', error: false }]);
  });

  it('reports a failed placement to the UI', async () => {
    const send = await start(fake);
    await send({
      type: 'place',
      requestId: 8,
      images: [{ bytes: new Uint8Array([9]), width: 10, height: 10, url: 'https://cdn1.wiro.ai/a.png' }],
      targetIds: ['gone:1'],
      scaleMode: 'FILL',
      name: 'prompt',
      model: 'm/x',
    });
    const answer = lastPosted(fake) as { type: string; requestId: number; error?: string };
    expect(answer.type).toBe('placed');
    expect(answer.requestId).toBe(8);
    expect(answer.error).toMatch(/gone/);
    expect(fake.notifications[0]!.error).toBe(true);
  });

  it('ignores malformed requests and links outside wiro.ai', async () => {
    const send = await start(fake);
    await send({ type: 'place', requestId: 1, images: 'nope' });
    await send({ type: 'open-url', url: 'https://example.com' });
    await send({ type: 'open-url', url: 'https://wiro.ai/panel/billing' });
    expect(fake.posted).toEqual([]);
    expect(fake.opened).toEqual(['https://wiro.ai/panel/billing']);
  });
});

import { describe, expect, it } from 'vitest';
import { createBridge, PlaceError, type Channel } from '../../src/ui/bridge';
import { describeError, elapsedLabel, formatUsd, shortPricing, stateLabel, taskCost } from '../../src/ui/format';
import { AuthError } from '../../src/ui/mcp';
import { mergeRecent, noImageReason, recentFrom } from '../../src/ui/results';
import type { TaskResult } from '../../src/ui/types';
import { WiroToolError } from '../../src/ui/wiro';
import type { UiToMain } from '../../src/shared/messages';

function result(
  state: TaskResult['state'],
  extra: Partial<TaskResult> = {},
  task: Partial<TaskResult['task']> = {},
): TaskResult {
  return { state, task: { id: '12', token: 't', ...task }, outputs: [], ...extra };
}

describe('formatUsd', () => {
  it('rounds the way prices read', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(85327.271)).toBe('$85,327.27');
    expect(formatUsd(0.2)).toBe('$0.20');
    expect(formatUsd(0.045)).toBe('$0.045');
    expect(formatUsd(0.003)).toBe('$0.003');
    expect(formatUsd(0.000123)).toBe('$0.000123');
  });
});

describe('shortPricing', () => {
  it('shortens the price lines of search_models', () => {
    expect(shortPricing({ pricing: '$0.04 / per output' })).toBe('$0.04 / image');
    expect(shortPricing({ pricing: '$0.005 / per request' })).toBe('$0.005 / run');
    expect(shortPricing({ pricing: '$0.14 to $0.24 / per output' })).toBe('from $0.14 / image');
    expect(shortPricing({ pricing: '$0.003 to $0.712 / per request' })).toBe('from $0.003 / run');
    expect(shortPricing({ pricing: '~$0.039349 per run (estimated)' })).toBe('about $0.039');
    expect(
      shortPricing({
        pricing: '$0.03 per run for an output image up to 1024 x 1024 pixels, plus $0.015 per further block',
      }),
    ).toBe('from $0.03 / image');
    expect(shortPricing({ pricing: 'Set by the run when it ends: Pricing is calculated from tokens.' })).toBe(
      'by usage',
    );
    expect(shortPricing({ estimatedCostUsd: 0.02 })).toBe('about $0.02');
    expect(shortPricing({})).toBe('');
  });
});

describe('task wording', () => {
  it('names the state', () => {
    expect(stateLabel(undefined)).toBe('Starting');
    expect(stateLabel(result('submitted'))).toBe('Generating');
    expect(stateLabel(result('running', {}, { status: 'task_queue' }))).toBe('Queued');
    expect(stateLabel(result('running', {}, { status: 'task_start' }))).toBe('Generating');
    expect(stateLabel(result('running', {}, { status: 'task_postprocess_start' }))).toBe('Finishing');
    expect(stateLabel(result('completed'))).toBe('Done');
  });

  it('prefers the charged amount over the list price', () => {
    expect(taskCost(result('completed', {}, { costUsd: 0.05, chargedUsd: 0.04 }))).toBe(0.04);
    expect(taskCost(result('completed', {}, { costUsd: 0.05 }))).toBe(0.05);
    expect(taskCost(result('completed'))).toBeUndefined();
  });

  it('counts seconds and minutes', () => {
    expect(elapsedLabel(12_400)).toBe('12 s');
    expect(elapsedLabel(75_000)).toBe('1 min 15 s');
  });
});

describe('describeError', () => {
  it('adds the billing link to balance errors', () => {
    expect(describeError(new WiroToolError('Insufficient balance. Add funds to continue.'))).toEqual({
      message: 'Insufficient balance. Add funds to continue.',
      link: { url: 'https://wiro.ai/panel/billing', label: 'Add funds' },
    });
  });

  it('marks key errors and explains network failures', () => {
    expect(describeError(new AuthError()).auth).toBe(true);
    expect(describeError(new TypeError('Failed to fetch')).message).toMatch(/could not be reached/);
    expect(describeError(new DOMException('Stopped', 'AbortError')).message).toBe('Stopped.');
  });
});

describe('results', () => {
  const done = result(
    'completed',
    {
      outputs: [
        { kind: 'image', mimeType: 'image/png', sizeBytes: 10, url: 'https://cdn1.wiro.ai/a/0.png' },
        { kind: 'image', mimeType: 'image/png', sizeBytes: 10, url: 'https://cdn1.wiro.ai/a/1.png' },
        { kind: 'text', mimeType: 'text/plain', sizeBytes: null, text: 'log' },
      ],
    },
    { chargedUsd: 0.08 },
  );

  it('keeps every image output, with the cost on the first', () => {
    expect(recentFrom(done, 'm/x', 'p', 5)).toEqual([
      { url: 'https://cdn1.wiro.ai/a/0.png', model: 'm/x', prompt: 'p', createdAt: 5, taskId: '12', costUsd: 0.08 },
      { url: 'https://cdn1.wiro.ai/a/1.png', model: 'm/x', prompt: 'p', createdAt: 5, taskId: '12' },
    ]);
  });

  it('puts new images first without repeats', () => {
    const old = recentFrom(done, 'm/x', 'old', 1);
    const added = recentFrom(done, 'm/x', 'new', 2).slice(0, 1);
    const merged = mergeRecent(added, old);
    expect(merged.map((image) => `${image.prompt}:${image.url.slice(-5)}`)).toEqual(['new:0.png', 'old:1.png']);
  });

  it('explains a task without images', () => {
    expect(noImageReason(result('failed', { error: 'Prompt was blocked' }))).toBe('Prompt was blocked');
    expect(noImageReason(result('cancelled'))).toBe('The run was cancelled.');
    expect(noImageReason(result('completed', { response: 'I cannot draw that.' }))).toBe(
      'The model returned no image: I cannot draw that.',
    );
    expect(noImageReason(result('completed'))).toBe('The model finished without an image.');
  });
});

describe('bridge', () => {
  function fakeChannel() {
    const sent: UiToMain[] = [];
    let handler: ((message: unknown) => void) | undefined;
    const channel: Channel = {
      post: (message) => sent.push(message),
      subscribe: (next) => {
        handler = next;
        return () => (handler = undefined);
      },
    };
    return { channel, sent, deliver: (message: unknown) => handler?.(message) };
  }

  it('matches each placement with its answer', async () => {
    const { channel, sent, deliver } = fakeChannel();
    const bridge = createBridge(channel);
    const image = { bytes: new Uint8Array([1]), width: 1, height: 1, url: 'https://cdn1.wiro.ai/a.png' };
    const first = bridge.place({ images: [image], targetIds: [], scaleMode: 'FILL', name: 'a', model: 'm/x' });
    const second = bridge.place({ images: [image], targetIds: ['1:1'], scaleMode: 'FIT', name: 'b', model: 'm/x' });
    expect(sent.map((message) => (message as { requestId?: number }).requestId)).toEqual([1, 2]);
    deliver({ type: 'placed', requestId: 2, error: 'The layers are gone' });
    deliver({ type: 'placed', requestId: 1, result: { filled: 0, created: 1, missing: 0 } });
    await expect(first).resolves.toEqual({ filled: 0, created: 1, missing: 0 });
    await expect(second).rejects.toBeInstanceOf(PlaceError);
  });
});

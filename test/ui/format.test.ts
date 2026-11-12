import { describe, expect, it } from 'vitest';
import { BridgeError, createBridge, REQUEST_TIMEOUT_MS, type Channel, type Timer } from '../../src/ui/bridge';
import { describeError, elapsedLabel, formatUsd, shortPricing, stateLabel, taskCost } from '../../src/ui/format';
import { AuthError } from '../../src/ui/mcp';
import {
  imageOutputs,
  inlineText,
  mergeRecent,
  modelError,
  noResultReason,
  otherOutputs,
  readAnswer,
  recentFrom,
  stripThinking,
  svgOutputs,
  textAnswer,
} from '../../src/ui/results';
import type { TaskOutput, TaskResult } from '../../src/ui/types';
import { WiroToolError } from '../../src/ui/wiro';
import type { UiToMain } from '../../src/shared/messages';

function result(
  state: TaskResult['state'],
  extra: Partial<TaskResult> = {},
  task: Partial<TaskResult['task']> = {},
): TaskResult {
  return { state, task: { id: '12', token: 't', ...task }, outputs: [], ...extra };
}

const file = (fields: Partial<TaskOutput>): TaskOutput => ({
  kind: 'file',
  mimeType: 'application/octet-stream',
  sizeBytes: 1,
  ...fields,
});

describe('formatUsd and shortPricing', () => {
  it('rounds the way prices read', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(85327.271)).toBe('$85,327.27');
    expect(formatUsd(0.2)).toBe('$0.20');
    expect(formatUsd(0.045)).toBe('$0.045');
    expect(formatUsd(0.000123)).toBe('$0.000123');
  });

  it('shortens the price lines of search_models', () => {
    expect(shortPricing({ pricing: '$0.04 / per output' })).toBe('$0.04 / image');
    expect(shortPricing({ pricing: '$0.005 / per request' })).toBe('$0.005 / run');
    expect(shortPricing({ pricing: '$0.14 to $0.24 / per output' })).toBe('from $0.14 / image');
    expect(shortPricing({ pricing: '~$0.039349 per run (estimated)' })).toBe('about $0.039');
    expect(shortPricing({ pricing: 'Set by the run when it ends: tokens.' })).toBe('by usage');
    expect(shortPricing({ estimatedCostUsd: 0.02 })).toBe('about $0.02');
    expect(shortPricing({})).toBe('');
  });
});

describe('task wording', () => {
  it('names the state', () => {
    expect(stateLabel(undefined)).toBe('Starting');
    expect(stateLabel(result('submitted'))).toBe('Generating');
    expect(stateLabel(result('running', {}, { status: 'task_queue' }))).toBe('Queued');
    expect(stateLabel(result('running', {}, { status: 'task_postprocess_start' }))).toBe('Finishing');
    expect(stateLabel(result('completed'))).toBe('Done');
  });

  it('prefers the charged amount over the list price', () => {
    expect(taskCost(result('completed', {}, { costUsd: 0.05, chargedUsd: 0.04 }))).toBe(0.04);
    expect(taskCost(result('completed', {}, { costUsd: 0.05 }))).toBe(0.05);
    expect(taskCost(result('completed'))).toBeUndefined();
    expect(elapsedLabel(75_000)).toBe('1 min 15 s');
  });
});

describe('describeError', () => {
  it('adds the billing link to balance errors and marks key errors', () => {
    expect(describeError(new WiroToolError('Insufficient balance. Add funds to continue.')).link).toEqual({
      url: 'https://wiro.ai/panel/billing',
      label: 'Add funds',
    });
    expect(describeError(new AuthError()).auth).toBe(true);
  });

  it('calls only real network failures a connection problem', () => {
    expect(describeError(new TypeError('Failed to fetch')).message).toMatch(/could not be reached/);
    expect(describeError(new TypeError('Illegal invocation')).message).toBe('Something went wrong: Illegal invocation');
    expect(describeError(new DOMException('Stopped', 'AbortError')).message).toBe('Stopped.');
  });
});

describe('results', () => {
  const done = result(
    'completed',
    {
      outputs: [
        { kind: 'image', mimeType: 'image/png', sizeBytes: 10, url: 'https://cdn1.wiro.ai/a/0.png' },
        { kind: 'image', mimeType: 'image/svg+xml', sizeBytes: 10, url: 'https://cdn1.wiro.ai/a/1.svg' },
        file({ kind: 'video', mimeType: 'video/mp4', url: 'https://cdn1.wiro.ai/a/2.mp4' }),
        file({ kind: 'text', mimeType: 'text/plain', url: 'https://cdn1.wiro.ai/a/output.txt' }),
      ],
    },
    { chargedUsd: 0.08 },
  );

  it('sorts outputs into pictures, vectors, text files and other files', () => {
    expect(imageOutputs(done).map((output) => output.url)).toEqual(['https://cdn1.wiro.ai/a/0.png']);
    expect(svgOutputs(done).map((output) => output.url)).toEqual(['https://cdn1.wiro.ai/a/1.svg']);
    expect(otherOutputs(done).map((output) => output.url)).toEqual(['https://cdn1.wiro.ai/a/2.mp4']);
  });

  it('keeps pictures and vectors for Recent, with the cost on the first', () => {
    expect(recentFrom(done, 'm/x', 'p', 5)).toEqual([
      { url: 'https://cdn1.wiro.ai/a/0.png', model: 'm/x', prompt: 'p', createdAt: 5, taskId: '12', costUsd: 0.08 },
      { url: 'https://cdn1.wiro.ai/a/1.svg', kind: 'svg', model: 'm/x', prompt: 'p', createdAt: 5, taskId: '12' },
    ]);
    const merged = mergeRecent(recentFrom(done, 'm/x', 'new', 2).slice(0, 1), recentFrom(done, 'm/x', 'old', 1));
    expect(merged.map((image) => `${image.prompt}:${image.url.slice(-5)}`)).toEqual(['new:0.png', 'old:1.svg']);
  });

  it('reads an LLM answer inline, and the response only when there are no files', async () => {
    const llm = result('completed', {
      response: 'Plan smarter.',
      outputs: [{ kind: 'text', mimeType: 'text/plain', sizeBytes: null, text: 'Plan smarter.' }],
    });
    expect(inlineText(llm)).toBe('Plan smarter.');
    expect(textAnswer(llm)).toBe('Plan smarter.');
    expect(textAnswer(result('completed', { response: 'only text' }))).toBe('only text');
    expect(textAnswer(result('completed', { response: 'VQA: 100%', outputs: done.outputs }))).toBeUndefined();
    const fetched: string[] = [];
    const answer = await readAnswer(
      result('completed', { response: 'VQA: 100%', outputs: done.outputs }),
      async (url) => {
        fetched.push(url);
        return new Response('<think>hmm</think>\nA mug of coffee.');
      },
    );
    expect(fetched).toEqual(['https://cdn1.wiro.ai/a/output.txt']);
    expect(answer).toBe('A mug of coffee.');
    expect(stripThinking('<think>open')).toBe('<think>open');
  });

  it('explains a task without a usable result, with the model’s own error line', () => {
    const failed = result('failed', { response: 'Request started.\nError: This model is temporarily unavailable.' });
    expect(modelError(failed)).toBe('This model is temporarily unavailable.');
    expect(noResultReason(failed, 'image')).toBe('The model could not do this: This model is temporarily unavailable.');
    expect(noResultReason(result('failed'), 'image')).toBe('The model could not do this.');
    expect(noResultReason(result('cancelled'), 'image')).toBe('The run was cancelled.');
    expect(noResultReason(result('completed', { response: 'I cannot draw that.' }), 'image')).toBe(
      'The model returned no image: I cannot draw that.',
    );
    expect(noResultReason(result('completed'), 'svg')).toBe('The model finished without a vector.');
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

  function manualTimer() {
    const timers = new Map<number, () => void>();
    let next = 1;
    const timer: Timer = {
      set: (callback) => {
        timers.set(next, callback);
        return next++;
      },
      clear: (handle) => {
        timers.delete(handle as number);
      },
    };
    return { timer, fire: () => [...timers.values()].forEach((callback) => callback()), count: () => timers.size };
  }

  it('matches each request with its reply and clears its timer', async () => {
    const { channel, sent, deliver } = fakeChannel();
    const clock = manualTimer();
    const bridge = createBridge(channel, clock.timer);
    const first = bridge.request({ kind: 'read-text', limit: 5 });
    const second = bridge.request({ kind: 'export', maxSide: 2048, limit: 1 });
    expect(sent.map((message) => (message as { requestId?: number }).requestId)).toEqual([1, 2]);
    deliver({ type: 'reply', requestId: 2, error: 'Nothing selected' });
    deliver({ type: 'reply', requestId: 1, result: [{ id: '1:1', name: 'Title', characters: 'Hi' }] });
    await expect(first).resolves.toEqual([{ id: '1:1', name: 'Title', characters: 'Hi' }]);
    await expect(second).rejects.toBeInstanceOf(BridgeError);
    expect(clock.count()).toBe(0);
  });

  it('gives up when Figma does not answer in time', async () => {
    const { channel } = fakeChannel();
    const clock = manualTimer();
    const pending = createBridge(channel, clock.timer).request({ kind: 'insert-text', text: 'Hi', name: 'n' });
    clock.fire();
    await expect(pending).rejects.toThrow('did not answer in time');
    expect(REQUEST_TIMEOUT_MS.place).toBeGreaterThan(REQUEST_TIMEOUT_MS['read-text']);
  });
});

import { describe, expect, it } from 'vitest';
import { AuthError, McpError, type McpClient, type ToolResult } from '../../src/ui/mcp';
import type { TaskResult } from '../../src/ui/types';
import { cleanToolText, toolError, WiroApi, WiroToolError } from '../../src/ui/wiro';

type Script = Array<ToolResult<unknown> | Error>;

/** A fake MCP client that answers each tool from its own script, in order. */
function fakeMcp(scripts: Record<string, Script>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const mcp = {
    async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
      calls.push({ name, args });
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const next = scripts[name]?.shift();
      if (!next) throw new Error(`No scripted answer for ${name}`);
      if (next instanceof Error) throw next;
      return next;
    },
  } as unknown as McpClient;
  return { mcp, calls };
}

function task(state: TaskResult['state'], extra: Partial<TaskResult> = {}): ToolResult<TaskResult> {
  return {
    structured: { state, task: { id: '5', token: 'tok', status: state }, outputs: [], ...extra },
    text: '',
    isError: false,
  };
}

const noPause = async () => undefined;

describe('WiroApi.runToEnd', () => {
  it('starts once without waiting, then waits until the task ends', async () => {
    const { mcp, calls } = fakeMcp({
      run_model: [task('submitted')],
      wait_for_task: [
        task('running'),
        task('completed', {
          outputs: [{ kind: 'image', mimeType: 'image/png', sizeBytes: 1, url: 'https://cdn1.wiro.ai/a.png' }],
        }),
      ],
    });
    const seen: string[] = [];
    let startedToken: string | undefined;
    const result = await new WiroApi(mcp, noPause).runToEnd(
      'm/x',
      { prompt: 'p' },
      {
        onStarted: (started) => (startedToken = started.task.token),
        onUpdate: (update) => seen.push(update.state),
      },
    );
    expect(result.state).toBe('completed');
    expect(startedToken).toBe('tok');
    expect(seen).toEqual(['submitted', 'running', 'completed']);
    expect(calls.map((call) => call.name)).toEqual(['run_model', 'wait_for_task', 'wait_for_task']);
    expect(calls[0]!.args).toEqual({ model: 'm/x', params: { prompt: 'p' }, wait: false });
    expect(calls[1]!.args).toEqual({ tasktoken: 'tok', timeout_seconds: 45 });
  });

  it('tries a failed wait again and never sends the run twice', async () => {
    const { mcp, calls } = fakeMcp({
      run_model: [task('submitted')],
      wait_for_task: [new TypeError('Failed to fetch'), new McpError('HTTP 502', 502), task('completed')],
    });
    const result = await new WiroApi(mcp, noPause).runToEnd('m/x', {});
    expect(result.state).toBe('completed');
    expect(calls.filter((call) => call.name === 'run_model')).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'wait_for_task')).toHaveLength(3);
  });

  it('gives up after repeated network failures', async () => {
    const failures = Array.from({ length: 6 }, () => new TypeError('Failed to fetch'));
    const { mcp, calls } = fakeMcp({ run_model: [task('submitted')], wait_for_task: failures });
    await expect(new WiroApi(mcp, noPause).runToEnd('m/x', {})).rejects.toThrow('Failed to fetch');
    expect(calls.filter((call) => call.name === 'run_model')).toHaveLength(1);
  });

  it('stops the task on Wiro when the run is cancelled', async () => {
    const controller = new AbortController();
    const { mcp, calls } = fakeMcp({
      run_model: [task('submitted')],
      wait_for_task: [task('running')],
      kill_task: [{ structured: {}, text: '', isError: false }],
    });
    const api = new WiroApi(mcp, noPause);
    const pending = api.runToEnd(
      'm/x',
      {},
      {
        signal: controller.signal,
        onUpdate: (update) => {
          if (update.state === 'running') controller.abort();
        },
      },
    );
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.map((call) => call.name)).toEqual(['run_model', 'wait_for_task', 'kill_task']);
    expect(calls[2]!.args).toEqual({ tasktoken: 'tok' });
  });

  it('kills a task that was cancelled while it was being started', async () => {
    const controller = new AbortController();
    controller.abort();
    const { mcp, calls } = fakeMcp({
      run_model: [task('submitted')],
      kill_task: [{ structured: {}, text: '', isError: false }],
    });
    await expect(new WiroApi(mcp, noPause).runToEnd('m/x', {}, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls.map((call) => call.name)).toEqual(['run_model', 'kill_task']);
  });

  it('fails when the task has no token', async () => {
    const { mcp } = fakeMcp({
      run_model: [{ structured: { state: 'submitted', task: { id: '9' }, outputs: [] }, text: '', isError: false }],
    });
    await expect(new WiroApi(mcp, noPause).runToEnd('m/x', {})).rejects.toThrow('task 9');
  });

  it('turns tool errors into readable errors', async () => {
    const { mcp } = fakeMcp({
      run_model: [{ text: '## Error\n\nFailed to run model: Request parameter [ratio] required', isError: true }],
    });
    await expect(new WiroApi(mcp, noPause).runToEnd('m/x', {})).rejects.toThrow(
      'Failed to run model: Request parameter [ratio] required',
    );
  });
});

describe('toolError', () => {
  it('recognises a refused key and a missing secret', () => {
    expect(toolError('## Error\n\nWiro API error 401: Project authorization is not founded.')).toBeInstanceOf(
      AuthError,
    );
    const secret = toolError(
      '## Error\n\nThis project uses signature-based auth. Enter API_KEY:API_SECRET (the key and secret joined with a colon) as the API key.',
    );
    expect(secret).toBeInstanceOf(AuthError);
    expect(secret.message).toMatch(/API secret/);
    expect(toolError('## Error\n\nInsufficient balance')).toBeInstanceOf(WiroToolError);
  });

  it('strips the Markdown heading', () => {
    expect(cleanToolText('## Error\n\nSomething')).toBe('Something');
    expect(cleanToolText('')).toBe('Wiro AI could not do that.');
  });
});

describe('WiroApi reads', () => {
  it('asks search_models for one category, sorted by popularity', async () => {
    const { mcp, calls } = fakeMcp({
      search_models: [{ structured: { models: [], total: 0, nextStart: null }, text: '', isError: false }],
    });
    await new WiroApi(mcp).searchModels({ categories: ['text-to-image'], sort: 'ratedusercount' });
    expect(calls[0]).toEqual({
      name: 'search_models',
      args: { limit: 100, start: 0, sort: 'ratedusercount', categories: ['text-to-image'] },
    });
  });

  it('returns the model of get_model_schema', async () => {
    const { mcp } = fakeMcp({
      get_model_schema: [
        {
          structured: { model: { slug: 'a/b', title: 'B', categories: [], parameters: [] } },
          text: '',
          isError: false,
        },
      ],
    });
    expect((await new WiroApi(mcp).getModel('a/b')).slug).toBe('a/b');
  });
});

import { describe, expect, it } from 'vitest';
import { AuthError, McpError, type McpClient, type ToolResult } from '../../src/ui/mcp';
import type { TaskResult } from '../../src/ui/types';
import { cleanToolText, toolError, WaitError, WiroApi, WiroToolError } from '../../src/ui/wiro';

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

const toolFailure = (text: string): ToolResult<unknown> => ({ text, isError: true });
const ok: ToolResult<unknown> = { structured: {}, text: '', isError: false };
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
      { onStarted: (started) => (startedToken = started.task.token), onUpdate: (update) => seen.push(update.state) },
    );
    expect(result.state).toBe('completed');
    expect(startedToken).toBe('tok');
    expect(seen).toEqual(['submitted', 'running', 'completed']);
    expect(calls.map((call) => call.name)).toEqual(['run_model', 'wait_for_task', 'wait_for_task']);
    expect(calls[0]!.args).toEqual({ model: 'm/x', params: { prompt: 'p' }, wait: false });
    expect(calls[1]!.args).toEqual({ tasktoken: 'tok', timeout_seconds: 45 });
  });

  it('tries failed waits again, server-side failures too, and never sends the run twice', async () => {
    const { mcp, calls } = fakeMcp({
      run_model: [task('submitted')],
      wait_for_task: [
        new TypeError('Failed to fetch'),
        new McpError('HTTP 502', 502),
        toolFailure(
          '## Task Status Error\n\nStatus checks failed. **Task Token:** tok. Retry `wait_for_task` with the same identifier.',
        ),
        task('completed'),
      ],
    });
    const result = await new WiroApi(mcp, noPause).runToEnd('m/x', {});
    expect(result.state).toBe('completed');
    expect(calls.filter((call) => call.name === 'run_model')).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'wait_for_task')).toHaveLength(4);
  });

  it('stops waiting after repeated failures and keeps the token', async () => {
    const failures = Array.from({ length: 7 }, () => new TypeError('Failed to fetch'));
    const { mcp, calls } = fakeMcp({ run_model: [task('submitted')], wait_for_task: failures });
    const error = await new WiroApi(mcp, noPause).runToEnd('m/x', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WaitError);
    expect((error as WaitError).tasktoken).toBe('tok');
    expect(calls.filter((call) => call.name === 'run_model')).toHaveLength(1);
  });

  it('gives up at once when the task is not found or the key is refused', async () => {
    const lost = fakeMcp({
      run_model: [task('submitted')],
      wait_for_task: [toolFailure('## Error\n\nTask not found.')],
    });
    await expect(new WiroApi(lost.mcp, noPause).runToEnd('m/x', {})).rejects.toBeInstanceOf(WiroToolError);
    const refused = fakeMcp({ run_model: [task('submitted')], wait_for_task: [new AuthError()] });
    await expect(new WiroApi(refused.mcp, noPause).runToEnd('m/x', {})).rejects.toBeInstanceOf(AuthError);
  });

  it('leaves stopping to stop() when the wait is aborted', async () => {
    const controller = new AbortController();
    const { mcp, calls } = fakeMcp({ run_model: [task('submitted')], wait_for_task: [task('running')] });
    const pending = new WiroApi(mcp, noPause).runToEnd(
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
    expect(calls.map((call) => call.name)).toEqual(['run_model', 'wait_for_task']);
  });

  it('fails clearly when the task has no token', async () => {
    const { mcp } = fakeMcp({
      run_model: [{ structured: { state: 'submitted', task: { id: '9' }, outputs: [] }, text: '', isError: false }],
    });
    await expect(new WiroApi(mcp, noPause).runToEnd('m/x', {})).rejects.toThrow('task 9');
  });
});

describe('WiroApi.stop', () => {
  it('stops a task', async () => {
    const { mcp, calls } = fakeMcp({ kill_task: [ok] });
    expect(await new WiroApi(mcp).stop('tok')).toEqual({ stopped: true });
    expect(calls).toEqual([{ name: 'kill_task', args: { tasktoken: 'tok' } }]);
  });

  it('returns the result of a task that had already finished', async () => {
    const { mcp } = fakeMcp({ kill_task: [toolFailure('## Error\n\nProcess ended')], get_task: [task('completed')] });
    const outcome = await new WiroApi(mcp).stop('tok');
    expect(outcome).toMatchObject({ stopped: false, result: { state: 'completed' } });
  });

  it('counts a task that failed or was cancelled anyway as stopped, and says when it cannot tell', async () => {
    const failed = fakeMcp({ kill_task: [new TypeError('Failed to fetch')], get_task: [task('cancelled')] });
    expect(await new WiroApi(failed.mcp).stop('tok')).toEqual({ stopped: true });
    const unknown = fakeMcp({ kill_task: [new TypeError('x')], get_task: [new TypeError('y')] });
    expect(await new WiroApi(unknown.mcp).stop('tok')).toEqual({ stopped: false });
  });
});

describe('tool errors', () => {
  it('recognises a refused key and a missing secret', () => {
    expect(toolError('## Error\n\nWiro API error 401: Project authorization is not founded.')).toBeInstanceOf(
      AuthError,
    );
    const secret = toolError(
      '## Error\n\nThis project uses signature-based auth. Enter API_KEY:API_SECRET as the API key.',
    );
    expect(secret).toBeInstanceOf(AuthError);
    expect(secret.message).toMatch(/API secret/);
    expect(toolError('## Error\n\nInsufficient balance')).toBeInstanceOf(WiroToolError);
  });

  it('keeps the message for people and drops lines meant for AI agents', () => {
    expect(cleanToolText('## Error\n\nSomething')).toBe('Something');
    expect(
      cleanToolText(
        '## Error\n\nThe task was created (task ID 5), but its token did not come back.\nDo not run the model again: read the task with get_task and taskid "5".',
      ),
    ).toBe('The task was created (task ID 5), but its token did not come back.');
    expect(cleanToolText('')).toBe('Wiro AI could not do that.');
    expect(cleanToolText(`## Error\n\n${'x'.repeat(600)}`)).toHaveLength(400);
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

  it('returns the schema with its price text, and the task list', async () => {
    const { mcp, calls } = fakeMcp({
      get_model_schema: [
        {
          structured: { model: { slug: 'a/b', title: 'B', categories: [], parameters: [] } },
          text: '### Pricing',
          isError: false,
        },
      ],
      list_tasks: [
        { structured: { tasks: [{ state: 'completed', task: { id: '1' }, outputs: [] }] }, text: '', isError: false },
      ],
    });
    const api = new WiroApi(mcp);
    const detail = await api.getModel('a/b');
    expect(detail.model.slug).toBe('a/b');
    expect(detail.text).toBe('### Pricing');
    expect(await api.listTasks(5)).toEqual([{ state: 'completed', task: { id: '1' }, outputs: [] }]);
    expect(calls[1]).toEqual({ name: 'list_tasks', args: { limit: 5 } });
  });
});

import { AuthError, McpError, type McpClient } from './mcp';
import type { Account, ModelDetail, ModelPage, TaskResult } from './types';

// The Wiro MCP tools the plugin uses. A tool error (isError) becomes an
// exception that carries the tool's own message.

export class WiroToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiroToolError';
  }
}

/** How long one wait_for_task call may hold the request, in seconds. */
export const WAIT_SECONDS = 45;

/** wait_for_task calls in a row that may fail on the network before the plugin gives up. */
const WAIT_RETRIES = 5;

export function cleanToolText(text: string): string {
  return text.replace(/^#+\s*Error\s*/i, '').trim() || 'Wiro AI could not do that.';
}

/** The error a tool's message stands for: a refused key, or anything else. */
export function toolError(text: string): Error {
  const message = cleanToolText(text);
  if (/signature-based auth/i.test(message)) {
    return new AuthError('This project uses signature authentication. Add its API secret along with the API key.');
  }
  if (/error 401\b|authorization is not found|unauthori[sz]ed/i.test(message)) return new AuthError();
  return new WiroToolError(message);
}

export function isTerminal(state: TaskResult['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export interface RunHandlers {
  /** Called once the task exists, with its token. */
  onStarted?: (result: TaskResult) => void;
  /** Called with every state the plugin sees. */
  onUpdate?: (result: TaskResult) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Stopped', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class WiroApi {
  constructor(
    private readonly mcp: McpClient,
    private readonly pause: (ms: number, signal?: AbortSignal) => Promise<void> = sleep,
  ) {}

  private async call<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const result = await this.mcp.callTool<T>(name, args, signal);
    if (result.isError) throw toolError(result.text);
    if (result.structured === undefined) throw new McpError(`${name} returned no data.`);
    return result.structured;
  }

  /** Checks the key and reads the balance. It costs nothing. */
  getAccount(signal?: AbortSignal): Promise<Account> {
    return this.call('get_account', {}, signal);
  }

  searchModels(
    options: { categories?: string[]; search?: string; sort?: string; start?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<ModelPage> {
    const args: Record<string, unknown> = {
      limit: options.limit ?? 100,
      start: options.start ?? 0,
      sort: options.sort ?? 'relevance',
    };
    if (options.categories?.length) args.categories = options.categories;
    if (options.search) args.search = options.search;
    return this.call('search_models', args, signal);
  }

  async getModel(slug: string, signal?: AbortSignal): Promise<ModelDetail> {
    const result = await this.call<{ model: ModelDetail }>('get_model_schema', { model: slug }, signal);
    return result.model;
  }

  /** Starts a task and returns at once with its token. Never called twice for one run. */
  startRun(model: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('run_model', { model, params, wait: false }, signal);
  }

  waitForTask(tasktoken: string, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('wait_for_task', { tasktoken, timeout_seconds: WAIT_SECONDS }, signal);
  }

  getTask(tasktoken: string, signal?: AbortSignal): Promise<TaskResult> {
    return this.call('get_task', { tasktoken }, signal);
  }

  /** Stops a task that has not finished: a queued one is cancelled, a running one killed. */
  async killTask(tasktoken: string): Promise<void> {
    await this.call('kill_task', { tasktoken });
  }

  /**
   * Waits for a task to end. A failed wait (the network, a busy server) is
   * tried again a few times; the run itself is never sent again, since that
   * would start and bill a second task. When the signal aborts, the task is
   * stopped on Wiro too.
   */
  async waitToEnd(first: TaskResult, handlers: RunHandlers = {}): Promise<TaskResult> {
    let result = first;
    let failures = 0;
    while (!isTerminal(result.state)) {
      const token = result.task.token ?? stringArg(result.nextAction?.arguments.tasktoken);
      if (!token) throw new WiroToolError('The task started, but Wiro AI did not send its token.');
      try {
        if (handlers.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        result = await this.waitForTask(token, handlers.signal);
        failures = 0;
        handlers.onUpdate?.(result);
      } catch (error) {
        if (isAbort(error)) {
          await this.killTask(token).catch(() => undefined);
          throw error;
        }
        if (error instanceof AuthError || error instanceof WiroToolError) throw error;
        failures += 1;
        if (failures > WAIT_RETRIES) throw error;
        const retryAfter = error instanceof McpError ? error.retryAfterSeconds : undefined;
        try {
          await this.pause((retryAfter ?? 2 ** failures) * 1000, handlers.signal);
        } catch (pauseError) {
          if (isAbort(pauseError)) await this.killTask(token).catch(() => undefined);
          throw pauseError;
        }
      }
    }
    return result;
  }

  /**
   * Runs a model to the end: one run_model call, then wait_for_task until the
   * task ends. The run_model call itself is not aborted, so a task that Wiro
   * created is always known and can be stopped.
   */
  async runToEnd(model: string, params: Record<string, unknown>, handlers: RunHandlers = {}): Promise<TaskResult> {
    const started = await this.startRun(model, params);
    if (!started.task.token) {
      const id = started.task.id ? ` (task ${started.task.id})` : '';
      throw new WiroToolError(`The task started${id}, but Wiro AI did not send its token.`);
    }
    handlers.onStarted?.(started);
    handlers.onUpdate?.(started);
    return this.waitToEnd(started, handlers);
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

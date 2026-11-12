import { AuthError, McpError, type McpClient } from './mcp';
import type { Account, ModelDetail, ModelPage, TaskResult } from './types';

// The Wiro MCP tools the plugin uses. A tool error (isError) becomes an
// exception with a message written for people: the tools also address AI
// agents ("call get_task with ..."), and those lines are left out.

export class WiroToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiroToolError';
  }
}

/** Waiting stopped after repeated failures. The task may still finish; its token is kept. */
export class WaitError extends Error {
  constructor(
    message: string,
    readonly tasktoken: string,
  ) {
    super(message);
    this.name = 'WaitError';
  }
}

/** How long one wait_for_task call may hold the request, in seconds. */
export const WAIT_SECONDS = 45;

/** Failed waits in a row before the plugin stops waiting and offers to keep waiting. */
const WAIT_RETRIES = 6;

const AGENT_LINE =
  /\b(get_task|wait_for_task|list_tasks|run_model|kill_task|cancel_task|nextAction|tool)\b|task token/i;

/** A tool's error text, made readable: no Markdown headings, no instructions meant for AI agents. */
export function cleanToolText(text: string): string {
  const lines = text
    .replace(/^#+\s*(Task Status )?Error\s*/i, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^#+\s*/, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .filter((line) => line && !AGENT_LINE.test(line));
  const message = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!message) return 'Wiro AI could not do that.';
  return message.length > 400 ? `${message.slice(0, 399)}…` : message;
}

/** The error a tool's message stands for: a refused key, or anything else. */
export function toolError(text: string): Error {
  if (/signature-based auth/i.test(text)) {
    return new AuthError('This project uses signature authentication. Add its API secret along with the API key.');
  }
  if (/error 401\b|authorization is not found|unauthori[sz]ed/i.test(text)) return new AuthError();
  return new WiroToolError(cleanToolText(text));
}

export function isTerminal(state: TaskResult['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

/** A wait error that will not get better by trying again. */
function isFinalWaitError(error: unknown): boolean {
  if (error instanceof AuthError) return true;
  return error instanceof WiroToolError && /not found|could not be found|does not exist|no task/i.test(error.message);
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

export interface ModelWithPricing {
  model: ModelDetail;
  /** The text the schema tool returns beside the structured schema; it holds the price table. */
  text: string;
}

export interface TaskListItem {
  state: TaskResult['state'];
  task: TaskResult['task'];
  outputs: TaskResult['outputs'];
}

export class WiroApi {
  constructor(
    private readonly mcp: McpClient,
    private readonly pause: (ms: number, signal?: AbortSignal) => Promise<void> = sleep,
  ) {}

  private async callFull<T>(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ structured: T; text: string }> {
    const result = await this.mcp.callTool<T>(name, args, signal);
    if (result.isError) throw toolError(result.text);
    if (result.structured === undefined) throw new McpError(`${name} returned no data.`);
    return { structured: result.structured, text: result.text };
  }

  private async call<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return (await this.callFull<T>(name, args, signal)).structured;
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

  async getModel(slug: string, signal?: AbortSignal): Promise<ModelWithPricing> {
    const result = await this.callFull<{ model: ModelDetail }>('get_model_schema', { model: slug }, signal);
    return { model: result.structured.model, text: result.text };
  }

  /** The account's recent tasks, newest first. */
  async listTasks(limit = 30, signal?: AbortSignal): Promise<TaskListItem[]> {
    const result = await this.call<{ tasks: TaskListItem[] }>('list_tasks', { limit }, signal);
    return result.tasks;
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
   * Waits for a task to end. A failed wait (the network, a busy server, a
   * status check Wiro could not finish) is tried again; the run itself is never
   * sent again, since that would start and bill a second task. After repeated
   * failures it throws a WaitError that keeps the token, so the panel can offer
   * to keep waiting. An aborted wait stops nothing by itself: see stop().
   */
  async waitToEnd(first: TaskResult, handlers: RunHandlers = {}): Promise<TaskResult> {
    let result = first;
    let failures = 0;
    while (!isTerminal(result.state)) {
      const token = result.task.token ?? stringArg(result.nextAction?.arguments.tasktoken);
      if (!token) throw new WiroToolError('The task started, but Wiro AI did not send its token.');
      if (handlers.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      try {
        result = { ...(await this.waitForTask(token, handlers.signal)) };
        if (!result.task.token) result.task = { ...result.task, token };
        failures = 0;
        handlers.onUpdate?.(result);
      } catch (error) {
        if (isAbort(error) || isFinalWaitError(error)) throw error;
        failures += 1;
        if (failures > WAIT_RETRIES) {
          throw new WaitError(
            'Wiro AI did not answer for a while, so the plugin stopped waiting. The task may still finish.',
            token,
          );
        }
        const retryAfter = error instanceof McpError ? error.retryAfterSeconds : undefined;
        await this.pause(Math.min(30, retryAfter ?? 2 ** failures) * 1000, handlers.signal);
      }
    }
    return result;
  }

  /**
   * Stops a task. When Wiro refuses (the task already ended) or the call is
   * lost, the task is read once more: a task that finished is returned so its
   * result is not thrown away; otherwise the outcome is unknown.
   */
  async stop(tasktoken: string): Promise<{ stopped: true } | { stopped: false; result?: TaskResult }> {
    try {
      await this.killTask(tasktoken);
      return { stopped: true };
    } catch {
      try {
        const result = await this.getTask(tasktoken);
        return isTerminal(result.state) && result.state !== 'completed'
          ? { stopped: true }
          : { stopped: false, result };
      } catch {
        return { stopped: false };
      }
    }
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
      throw new WiroToolError(
        `The task started${id}, but Wiro AI did not send its token. Check History before running it again.`,
      );
    }
    handlers.onStarted?.(started);
    handlers.onUpdate?.(started);
    return this.waitToEnd(started, handlers);
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

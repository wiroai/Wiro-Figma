import type { MainToUi, Request, RequestResults, UiToMain } from '../shared/messages';

// The UI's side of the channel to the main thread (src/code.ts).

export interface Bridge {
  send(message: UiToMain): void;
  /** Sends a request to the main thread and waits for its reply. */
  request<K extends Request['kind']>(request: Extract<Request, { kind: K }>): Promise<RequestResults[K]>;
  /** Listens to the main thread. Returns a function that stops listening. */
  listen(handler: (message: MainToUi) => void): () => void;
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface Channel {
  post(message: UiToMain): void;
  subscribe(handler: (message: unknown) => void): () => void;
}

/** How long the main thread may take to answer, by request kind. */
export const REQUEST_TIMEOUT_MS: Record<Request['kind'], number> = {
  place: 120_000,
  export: 120_000,
  'read-text': 30_000,
  'set-text': 120_000,
  'place-svg': 60_000,
  'insert-text': 30_000,
};

/**
 * The channel inside Figma: parent.postMessage out, window messages in, as
 * Figma documents it. Messages are told apart by their pluginMessage field,
 * not by event.source, since Figma decides which frame relays them.
 */
export function figmaChannel(): Channel {
  return {
    post(message) {
      parent.postMessage({ pluginMessage: message }, '*');
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        const data = event.data as { pluginMessage?: unknown } | null;
        if (data && typeof data === 'object' && 'pluginMessage' in data) handler(data.pluginMessage);
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

function isMainMessage(value: unknown): value is MainToUi {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export interface Timer {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

// setTimeout must be called on the window, not as a method of another object.
const windowTimer: Timer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBridge(channel: Channel, timer: Timer = windowTimer): Bridge {
  let nextRequest = 1;
  const waiting = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

  channel.subscribe((value) => {
    if (!isMainMessage(value) || value.type !== 'reply') return;
    const pending = waiting.get(value.requestId);
    if (!pending) return;
    waiting.delete(value.requestId);
    if (value.error !== undefined) pending.reject(new BridgeError(value.error));
    else pending.resolve(value.result);
  });

  return {
    send: (message) => channel.post(message),
    request<K extends Request['kind']>(request: Extract<Request, { kind: K }>): Promise<RequestResults[K]> {
      const requestId = nextRequest++;
      return new Promise<RequestResults[K]>((resolve, reject) => {
        const timeout = timer.set(() => {
          if (!waiting.delete(requestId)) return;
          reject(new BridgeError('Figma did not answer in time. Try again.'));
        }, REQUEST_TIMEOUT_MS[request.kind]);
        waiting.set(requestId, {
          resolve: (result) => {
            timer.clear(timeout);
            resolve(result as RequestResults[K]);
          },
          reject: (error) => {
            timer.clear(timeout);
            reject(error);
          },
        });
        channel.post({ type: 'request', requestId, request });
      });
    },
    listen(handler) {
      return channel.subscribe((value) => {
        if (isMainMessage(value)) handler(value);
      });
    },
  };
}

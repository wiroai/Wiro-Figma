import type { MainToUi, PlaceRequest, PlaceResult, UiToMain } from '../shared/messages';

// The UI's side of the channel to the main thread (src/code.ts).

export interface Bridge {
  send(message: UiToMain): void;
  /** Places images through the main thread and waits for the answer. */
  place(request: Omit<PlaceRequest, 'requestId'>): Promise<PlaceResult>;
  /** Listens to the main thread. Returns a function that stops listening. */
  listen(handler: (message: MainToUi) => void): () => void;
}

export class PlaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceError';
  }
}

export interface Channel {
  post(message: UiToMain): void;
  subscribe(handler: (message: unknown) => void): () => void;
}

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

export function createBridge(channel: Channel): Bridge {
  let nextRequest = 1;
  const waiting = new Map<number, { resolve: (result: PlaceResult) => void; reject: (error: Error) => void }>();

  channel.subscribe((value) => {
    if (!isMainMessage(value) || value.type !== 'placed') return;
    const pending = waiting.get(value.requestId);
    if (!pending) return;
    waiting.delete(value.requestId);
    if (value.result) pending.resolve(value.result);
    else pending.reject(new PlaceError(value.error ?? 'The image could not be placed.'));
  });

  return {
    send: (message) => channel.post(message),
    place(request) {
      const requestId = nextRequest++;
      return new Promise<PlaceResult>((resolve, reject) => {
        waiting.set(requestId, { resolve, reject });
        channel.post({ type: 'place', requestId, ...request });
      });
    },
    listen(handler) {
      return channel.subscribe((value) => {
        if (isMainMessage(value)) handler(value);
      });
    },
  };
}

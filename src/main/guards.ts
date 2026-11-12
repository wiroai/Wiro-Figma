import type { PlaceRequest } from '../shared/messages';

// Checks on what the UI sends before the main thread acts on it.

/** Links the UI may open: pages on wiro.ai only. */
export function isAllowedLink(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/wiro\.ai(\/\S*)?$/.test(url);
}

/** At most this many images and target layers in one request. */
export const MAX_IMAGES = 16;
export const MAX_TARGETS = 500;

export function isPlaceRequest(value: unknown): value is { type: 'place' } & PlaceRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<PlaceRequest> & { type?: unknown };
  return (
    message.type === 'place' &&
    typeof message.requestId === 'number' &&
    Array.isArray(message.images) &&
    message.images.length > 0 &&
    message.images.length <= MAX_IMAGES &&
    message.images.every(
      (image) =>
        typeof image === 'object' &&
        image !== null &&
        image.bytes instanceof Uint8Array &&
        image.bytes.length > 0 &&
        typeof image.width === 'number' &&
        image.width > 0 &&
        typeof image.height === 'number' &&
        image.height > 0 &&
        typeof image.url === 'string',
    ) &&
    Array.isArray(message.targetIds) &&
    message.targetIds.length <= MAX_TARGETS &&
    message.targetIds.every((id) => typeof id === 'string') &&
    (message.scaleMode === 'FILL' || message.scaleMode === 'FIT') &&
    typeof message.model === 'string' &&
    typeof message.name === 'string'
  );
}

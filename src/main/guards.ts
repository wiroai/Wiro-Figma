import type { Request } from '../shared/messages';

// Checks on what the UI sends before the main thread acts on it.

/** Links the UI may open: pages on wiro.ai and result files on Wiro AI's file server. */
export function isAllowedLink(url: unknown): url is string {
  return (
    typeof url === 'string' && (/^https:\/\/wiro\.ai(\/\S*)?$/.test(url) || /^https:\/\/cdn1\.wiro\.ai\/\S+$/.test(url))
  );
}

/** Limits for one request. */
export const MAX_IMAGES = 16;
export const MAX_TARGETS = 500;
export const MAX_TEXT_ITEMS = 200;
export const MAX_TEXT_LENGTH = 50_000;
export const MAX_SVG_LENGTH = 5_000_000;
export const MAX_EXPORT_SIDE = 4096;

const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isImagePayload(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    value.bytes instanceof Uint8Array &&
    value.bytes.length > 0 &&
    typeof value.width === 'number' &&
    value.width > 0 &&
    typeof value.height === 'number' &&
    value.height > 0 &&
    isString(value.url)
  );
}

/** True when the request has the fields its kind needs, within limits. */
export function isRequest(value: unknown): value is Request {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'place':
      return (
        Array.isArray(value.images) &&
        value.images.length > 0 &&
        value.images.length <= MAX_IMAGES &&
        value.images.every(isImagePayload) &&
        Array.isArray(value.targetIds) &&
        value.targetIds.length <= MAX_TARGETS &&
        value.targetIds.every(isString) &&
        (value.mode === 'fill' || value.mode === 'beside') &&
        isOptionalString(value.anchorId) &&
        (value.scaleMode === 'FILL' || value.scaleMode === 'FIT') &&
        isString(value.name) &&
        isString(value.model) &&
        isOptionalString(value.taskId)
      );
    case 'export':
      return (
        typeof value.maxSide === 'number' &&
        value.maxSide >= 64 &&
        value.maxSide <= MAX_EXPORT_SIDE &&
        typeof value.limit === 'number' &&
        value.limit >= 1 &&
        value.limit <= MAX_IMAGES
      );
    case 'read-text':
      return typeof value.limit === 'number' && value.limit >= 1 && value.limit <= MAX_TEXT_ITEMS;
    case 'set-text':
      return (
        Array.isArray(value.items) &&
        value.items.length > 0 &&
        value.items.length <= MAX_TEXT_ITEMS &&
        value.items.every(
          (item) => isObject(item) && isString(item.id) && isString(item.text) && item.text.length <= MAX_TEXT_LENGTH,
        )
      );
    case 'place-svg':
      return (
        isString(value.svg) &&
        value.svg.length > 0 &&
        value.svg.length <= MAX_SVG_LENGTH &&
        isString(value.name) &&
        isOptionalString(value.anchorId) &&
        isString(value.model) &&
        isOptionalString(value.taskId)
      );
    case 'insert-text':
      return (
        isString(value.text) &&
        value.text.length > 0 &&
        value.text.length <= MAX_TEXT_LENGTH &&
        isString(value.name) &&
        isOptionalString(value.anchorId)
      );
    default:
      return false;
  }
}

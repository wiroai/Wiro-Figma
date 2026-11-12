// Sizes and shapes. Shared by the main thread and the UI, so it sticks to
// ES2017 built-ins (the main thread's sandbox).

/** Figma stores images up to this size a side; createImage refuses larger ones. */
export const MAX_IMAGE_SIDE = 4096;

/** New rectangles show an image at most this wide or tall, in canvas units. */
export const NEW_LAYER_LONG_SIDE = 1024;

/** Space between new rectangles placed side by side. */
export const NEW_LAYER_GAP = 40;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** "16:9" becomes 16 / 9. Anything that is not a ratio gives null. */
export function parseRatio(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * The ratio among `values` that is closest to width:height, compared on a log
 * scale so 2:1 and 1:2 are as far from 1:1. Values that are not ratios, such as
 * "auto", are skipped. Ties keep the first value.
 */
export function nearestRatio(width: number, height: number, values: readonly string[]): string | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;
  const target = Math.log(width / height);
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const ratio = parseRatio(value);
    if (ratio === null) continue;
    const distance = Math.abs(Math.log(ratio) - target);
    if (distance < bestDistance - 1e-9) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

export interface PixelSizeRules {
  /** The longer side of the result, before rounding. */
  longSide: number;
  /** Both sides are rounded to a multiple of this. */
  step?: number;
  min?: number;
  max?: number;
}

/**
 * A width and height in pixels with the shape of width:height, for models that
 * take an exact size. The longer side gets `longSide`; both sides are rounded
 * to `step` and kept within min and max.
 */
export function pixelSizeFor(width: number, height: number, rules: PixelSizeRules): Size {
  const step = rules.step && rules.step > 0 ? rules.step : 1;
  const min = rules.min !== undefined && rules.min > 0 ? rules.min : step;
  const max = rules.max !== undefined && rules.max > 0 ? rules.max : Number.POSITIVE_INFINITY;
  const ratio = width > 0 && height > 0 ? width / height : 1;
  const long = Math.min(rules.longSide, max);
  const rawWidth = ratio >= 1 ? long : long * ratio;
  const rawHeight = ratio >= 1 ? long / ratio : long;
  const round = (value: number) => {
    const stepped = Math.round(value / step) * step;
    const floor = Math.ceil(min / step) * step;
    const ceiling = Math.floor(max / step) * step;
    return Math.max(floor, Math.min(ceiling, stepped));
  };
  return { width: round(rawWidth), height: round(rawHeight) };
}

/** Scales a size down, never up, so neither side is longer than `maxSide`. */
export function fitWithin(size: Size, maxSide: number): Size {
  const longest = Math.max(size.width, size.height);
  if (!(longest > maxSide)) return { width: size.width, height: size.height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Top-left corners for layers placed in one row, `gap` apart, with the row
 * centred on `center`. Rows are aligned on their vertical centres.
 */
export function layoutRow(sizes: readonly Size[], center: Point, gap: number): Point[] {
  const total = sizes.reduce((sum, size) => sum + size.width, 0) + gap * Math.max(0, sizes.length - 1);
  let x = center.x - total / 2;
  return sizes.map((size) => {
    const point = { x: Math.round(x), y: Math.round(center.y - size.height / 2) };
    x += size.width + gap;
    return point;
  });
}

import { fitWithin, MAX_IMAGE_SIDE, type Size } from '../shared/geometry';
import type { ImagePayload } from '../shared/messages';

// Turns a finished image into bytes figma.createImage takes: PNG, JPEG or GIF,
// at most 4096 px a side. Other formats (WebP, AVIF) and larger images are
// redrawn on a canvas in the UI iframe, which has the browser's decoders.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'other';

export function sniffFormat(bytes: Uint8Array): ImageFormat {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return 'other';
}

function uint16be(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}

function uint32be(b: Uint8Array, at: number): number {
  return (((b[at] ?? 0) << 24) >>> 0) + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0);
}

/** Width and height from the file header, without decoding the image. */
export function readSize(bytes: Uint8Array, format: ImageFormat = sniffFormat(bytes)): Size | undefined {
  if (format === 'png') {
    // The IHDR chunk comes first: width and height at bytes 16 and 20.
    if (bytes.length < 24) return undefined;
    return positive({ width: uint32be(bytes, 16), height: uint32be(bytes, 20) });
  }
  if (format === 'gif') {
    if (bytes.length < 10) return undefined;
    return positive({
      width: (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8),
      height: (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8),
    });
  }
  if (format === 'jpeg') return jpegSize(bytes);
  return undefined;
}

function positive(size: Size): Size | undefined {
  return size.width > 0 && size.height > 0 ? size : undefined;
}

/** Start-of-frame markers carry the size. C4, C8 and CC are other segments. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(bytes: Uint8Array): Size | undefined {
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers without a length: TEM, RST0-7, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = uint16be(bytes, at + 2);
    if (length < 2) return undefined;
    if (isStartOfFrame(marker)) {
      if (at + 8 >= bytes.length) return undefined;
      return positive({ height: uint16be(bytes, at + 5), width: uint16be(bytes, at + 7) });
    }
    at += 2 + length;
  }
  return undefined;
}

/** Formats figma.createImage reads. */
export function isFigmaFormat(format: ImageFormat): boolean {
  return format === 'png' || format === 'jpeg' || format === 'gif';
}

/** Redraws an image as PNG or JPEG, scaled down to at most `maxSide` px a side. */
export type Redraw = (
  bytes: Uint8Array,
  size: Size | undefined,
  type: 'image/png' | 'image/jpeg',
  maxSide?: number,
) => Promise<Converted>;

export interface Converted {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/** Downloads an output image and returns bytes Figma can use. */
export async function prepareImage(
  url: string,
  options: { fetchImpl?: Fetcher; redraw?: Redraw; signal?: AbortSignal } = {},
): Promise<ImagePayload> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: options.signal });
  } catch {
    throw new ImageError(
      'The image is ready but could not be downloaded. It is in Recent: click it there to try again.',
    );
  }
  if (!response.ok) throw new ImageError(`The image could not be downloaded (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new ImageError('The image file was empty.');
  const format = sniffFormat(bytes);
  const size = readSize(bytes, format);
  if (isFigmaFormat(format) && size && Math.max(size.width, size.height) <= MAX_IMAGE_SIDE) {
    return { bytes, width: size.width, height: size.height, url };
  }
  // GIFs are redrawn as PNG (only the first frame survives); photos stay JPEG.
  const redraw = options.redraw ?? redrawOnCanvas;
  const converted = await redraw(bytes, size, format === 'jpeg' ? 'image/jpeg' : 'image/png', MAX_IMAGE_SIDE);
  return { bytes: converted.bytes, width: converted.width, height: converted.height, url };
}

/** The browser path: decode with createImageBitmap, draw scaled down, encode. */
export const redrawOnCanvas: Redraw = async (bytes, _size, type, maxSide = MAX_IMAGE_SIDE) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    throw new ImageError('This image format could not be read.');
  }
  const target = fitWithin({ width: bitmap.width, height: bitmap.height }, maxSide);
  let blob: Blob | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('The image could not be redrawn.');
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await canvas.convertToBlob({ type, quality: 0.9 });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('The image could not be redrawn.');
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  }
  bitmap.close();
  if (!blob) throw new ImageError('The image could not be redrawn.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: target.width, height: target.height };
};

// ---------------------------------------------------------------------------
// Images sent to a model

/**
 * The largest image sent to a model, in bytes. Base64 makes it a third larger,
 * and the MCP endpoint takes request bodies up to 4 MB.
 */
export const MAX_INPUT_BYTES = 2_400_000;

/** Images sent to a model are at most this many pixels a side. */
export const MAX_INPUT_SIDE = 2048;

const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  other: 'application/octet-stream',
};

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/**
 * A selected layer's image as a data URI a model can read. Images within the
 * limits go as they are; larger ones are scaled down, PNG first (it keeps
 * transparency), JPEG when PNG stays too big.
 */
export async function inputDataUri(
  image: { bytes: Uint8Array; width: number; height: number },
  options: { maxBytes?: number; maxSide?: number; redraw?: Redraw } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_INPUT_BYTES;
  const maxSide = options.maxSide ?? MAX_INPUT_SIDE;
  const redraw = options.redraw ?? redrawOnCanvas;
  const format = sniffFormat(image.bytes);
  const known = format !== 'other';
  if (known && image.bytes.length <= maxBytes && Math.max(image.width, image.height) <= maxSide) {
    return `data:${MIME[format]};base64,${toBase64(image.bytes)}`;
  }
  const size = { width: image.width, height: image.height };
  let side = Math.min(maxSide, Math.max(image.width, image.height));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const types: Array<'image/png' | 'image/jpeg'> = format === 'jpeg' ? ['image/jpeg'] : ['image/png', 'image/jpeg'];
    for (const type of types) {
      const converted = await redraw(image.bytes, size, type, side);
      if (converted.bytes.length <= maxBytes) return `data:${type};base64,${toBase64(converted.bytes)}`;
    }
    side = Math.round(side * 0.75);
  }
  throw new ImageError('The selected image is too large to send. Try a smaller layer.');
}

/** Downloads an SVG result as text. */
export async function fetchSvg(url: string, fetchImpl: Fetcher = (input, init) => fetch(input, init)): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new ImageError('The vector is ready but could not be downloaded. Try again from History.');
  }
  if (!response.ok) throw new ImageError(`The vector could not be downloaded (HTTP ${response.status}).`);
  const text = await response.text();
  if (!/<svg[\s>]/i.test(text)) throw new ImageError('The model did not return an SVG.');
  return text;
}

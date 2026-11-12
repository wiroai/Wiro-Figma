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

/** Redraws an image as PNG or JPEG at the given size. */
export type Redraw = (
  bytes: Uint8Array,
  size: Size | undefined,
  type: 'image/png' | 'image/jpeg',
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
  const response = await fetchImpl(url, { signal: options.signal });
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
  const converted = await redraw(bytes, size, format === 'jpeg' ? 'image/jpeg' : 'image/png');
  return { bytes: converted.bytes, width: converted.width, height: converted.height, url };
}

/** The browser path: decode with createImageBitmap, draw scaled down, encode. */
export const redrawOnCanvas: Redraw = async (bytes, _size, type) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    throw new ImageError('This image format could not be read.');
  }
  const target = fitWithin({ width: bitmap.width, height: bitmap.height }, MAX_IMAGE_SIDE);
  let blob: Blob | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('The image could not be redrawn.');
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await canvas.convertToBlob({ type, quality: 0.92 });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('The image could not be redrawn.');
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  }
  bitmap.close();
  if (!blob) throw new ImageError('The image could not be redrawn.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: target.width, height: target.height };
};

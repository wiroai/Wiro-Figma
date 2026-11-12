import { describe, expect, it } from 'vitest';
import { ImageError, isFigmaFormat, prepareImage, readSize, sniffFormat, type Redraw } from '../../src/ui/images';

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // IHDR
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with the size.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array(12).fill(0)]);
}

function gif(width: number, height: number): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0, 0]);
}

const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

describe('sniffFormat and readSize', () => {
  it('knows PNG, JPEG, GIF and WebP by their bytes', () => {
    expect(sniffFormat(png(1, 1))).toBe('png');
    expect(sniffFormat(jpeg(1, 1))).toBe('jpeg');
    expect(sniffFormat(gif(1, 1))).toBe('gif');
    expect(sniffFormat(webp)).toBe('webp');
    expect(sniffFormat(new Uint8Array([1, 2, 3]))).toBe('other');
  });

  it('reads the size from the header', () => {
    expect(readSize(png(2048, 1152))).toEqual({ width: 2048, height: 1152 });
    expect(readSize(jpeg(1536, 1024))).toEqual({ width: 1536, height: 1024 });
    expect(readSize(gif(320, 240))).toEqual({ width: 320, height: 240 });
    expect(readSize(webp)).toBeUndefined();
    expect(readSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
  });

  it('lists the formats Figma reads', () => {
    expect(['png', 'jpeg', 'gif', 'webp', 'other'].filter((f) => isFigmaFormat(f as never))).toEqual([
      'png',
      'jpeg',
      'gif',
    ]);
  });
});

function fetchOf(bytes: Uint8Array, status = 200) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return new Response(status === 200 ? (bytes as BodyInit) : 'nope', { status });
  };
  return { calls, fetchImpl };
}

function recordingRedraw() {
  const calls: Array<{ type: string; size?: { width: number; height: number } }> = [];
  const redraw: Redraw = async (_bytes, size, type) => {
    calls.push({ type, size });
    return { bytes: new Uint8Array([7, 7, 7]), width: 4096, height: 2286 };
  };
  return { calls, redraw };
}

describe('prepareImage', () => {
  const url = 'https://cdn1.wiro.ai/x/0.png';

  it('passes a PNG within 4096 px through untouched', async () => {
    const bytes = png(2048, 2048);
    const { fetchImpl, calls } = fetchOf(bytes);
    const { redraw, calls: redraws } = recordingRedraw();
    const image = await prepareImage(url, { fetchImpl, redraw });
    expect(calls).toEqual([url]);
    expect(redraws).toEqual([]);
    expect(image).toEqual({ bytes, width: 2048, height: 2048, url });
  });

  it('redraws an image larger than 4096 px, keeping JPEG as JPEG', async () => {
    const { redraw, calls } = recordingRedraw();
    const image = await prepareImage(url, { fetchImpl: fetchOf(jpeg(5504, 3072)).fetchImpl, redraw });
    expect(calls).toEqual([{ type: 'image/jpeg', size: { width: 5504, height: 3072 } }]);
    expect(image).toMatchObject({ width: 4096, height: 2286, url });
  });

  it('redraws WebP as PNG', async () => {
    const { redraw, calls } = recordingRedraw();
    await prepareImage(url, { fetchImpl: fetchOf(webp).fetchImpl, redraw });
    expect(calls).toEqual([{ type: 'image/png', size: undefined }]);
  });

  it('fails clearly when the download fails or is empty', async () => {
    await expect(prepareImage(url, { fetchImpl: fetchOf(png(1, 1), 404).fetchImpl })).rejects.toThrow('HTTP 404');
    await expect(prepareImage(url, { fetchImpl: fetchOf(new Uint8Array()).fetchImpl })).rejects.toBeInstanceOf(
      ImageError,
    );
  });
});

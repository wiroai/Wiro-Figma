import { describe, expect, it } from 'vitest';
import {
  layerName,
  PLUGIN_DATA_KEY,
  PlacementError,
  placedMessage,
  placeImages,
  type PlacementApi,
} from '../../src/main/placement';
import { describeSelection, isFillable } from '../../src/main/selection';
import type { ImagePayload, PlaceRequest } from '../../src/shared/messages';
import { fakeFigma, fakeNode } from './fake-figma';

function payload(width: number, height: number, url = `https://cdn1.wiro.ai/x/${width}x${height}.png`): ImagePayload {
  return { bytes: new Uint8Array([1, 2, 3]), width, height, url };
}

function request(overrides: Partial<PlaceRequest> = {}): PlaceRequest {
  return {
    requestId: 1,
    images: [payload(1024, 1024)],
    targetIds: [],
    scaleMode: 'FILL',
    name: 'A cup of coffee',
    model: 'google/nano-banana-2',
    taskId: '42',
    ...overrides,
  };
}

const api = (fake: ReturnType<typeof fakeFigma>) => fake.figma as unknown as PlacementApi;

describe('isFillable and describeSelection', () => {
  it('accepts frames, shapes, text and instances with an area', () => {
    for (const type of ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'INSTANCE', 'COMPONENT', 'SECTION', 'VECTOR']) {
      expect(isFillable(fakeNode(type) as unknown as BaseNode)).toBe(true);
    }
  });

  it('skips groups, lines, slices and layers without an area', () => {
    expect(isFillable(fakeNode('GROUP', { noFills: true }) as unknown as BaseNode)).toBe(false);
    expect(isFillable(fakeNode('SLICE', { noFills: true }) as unknown as BaseNode)).toBe(false);
    expect(isFillable(fakeNode('LINE', { height: 0 }) as unknown as BaseNode)).toBe(false);
    expect(isFillable(fakeNode('RECTANGLE', { width: 0 }) as unknown as BaseNode)).toBe(false);
  });

  it('lists the targets in selection order and counts the rest', () => {
    const frame = fakeNode('FRAME', { name: 'Hero', width: 1440, height: 900 });
    const group = fakeNode('GROUP', { noFills: true });
    const ellipse = fakeNode('ELLIPSE', { name: 'Avatar', width: 64, height: 64 });
    const info = describeSelection([frame, group, ellipse] as unknown as SceneNode[]);
    expect(info.targets).toEqual([
      { id: frame.id, name: 'Hero', type: 'FRAME', width: 1440, height: 900 },
      { id: ellipse.id, name: 'Avatar', type: 'ELLIPSE', width: 64, height: 64 },
    ]);
    expect(info.skipped).toBe(1);
  });
});

describe('placeImages into selected layers', () => {
  it('fills each target with an image paint and keeps where it came from', async () => {
    const frame = fakeNode('FRAME', { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] });
    const fake = fakeFigma([frame]);
    const result = await placeImages(api(fake), request({ targetIds: [frame.id], scaleMode: 'FIT' }));
    expect(result).toEqual({ filled: 1, created: 0, missing: 0 });
    expect(frame.fills).toEqual([{ type: 'IMAGE', imageHash: 'hash-1', scaleMode: 'FIT' }]);
    expect(JSON.parse(frame.pluginData[PLUGIN_DATA_KEY]!)).toEqual({
      model: 'google/nano-banana-2',
      url: 'https://cdn1.wiro.ai/x/1024x1024.png',
      taskId: '42',
    });
    expect(fake.undoCommits).toBe(1);
    expect(fake.page.children).toHaveLength(0);
  });

  it('gives layer n image n and repeats the images when there are more layers', async () => {
    const layers = [fakeNode('FRAME'), fakeNode('FRAME'), fakeNode('FRAME')];
    const fake = fakeFigma(layers);
    await placeImages(
      api(fake),
      request({ images: [payload(512, 512), payload(512, 768)], targetIds: layers.map((node) => node.id) }),
    );
    const hashes = layers.map((node) => (node.fills as ImagePaint[])[0]!.imageHash);
    expect(hashes).toEqual(['hash-1', 'hash-2', 'hash-1']);
    expect(fake.images).toHaveLength(2);
  });

  it('skips layers that were deleted and reports them', async () => {
    const kept = fakeNode('RECTANGLE');
    const deleted = fakeNode('RECTANGLE', { removed: true });
    const fake = fakeFigma([kept, deleted]);
    const result = await placeImages(api(fake), request({ targetIds: [deleted.id, kept.id, 'missing:1'] }));
    expect(result).toEqual({ filled: 1, created: 0, missing: 2 });
    expect((kept.fills as ImagePaint[])[0]!.imageHash).toBe('hash-1');
  });

  it('refuses when every target is gone, without creating anything', async () => {
    const fake = fakeFigma([]);
    await expect(placeImages(api(fake), request({ targetIds: ['1:1', '2:2'] }))).rejects.toBeInstanceOf(PlacementError);
    expect(fake.page.children).toHaveLength(0);
    expect(fake.undoCommits).toBe(0);
  });

  it('refuses an empty request', async () => {
    await expect(placeImages(api(fakeFigma()), request({ images: [] }))).rejects.toThrow('no image');
  });
});

describe('placeImages without a selection', () => {
  it('adds one rectangle per image, sized to the image and centred in the view', async () => {
    const fake = fakeFigma();
    const result = await placeImages(api(fake), request({ images: [payload(2048, 1152)] }));
    expect(result).toEqual({ filled: 0, created: 1, missing: 0 });
    const [rectangle] = fake.page.children;
    expect(rectangle).toMatchObject({ type: 'RECTANGLE', width: 1024, height: 576, name: 'A cup of coffee' });
    // The view centre is (500, 300).
    expect(rectangle).toMatchObject({ x: -12, y: 12 });
    expect(rectangle!.fills).toEqual([{ type: 'IMAGE', imageHash: 'hash-1', scaleMode: 'FILL' }]);
    expect(fake.page.selection).toEqual([rectangle]);
    expect(fake.scrolledTo).toEqual([rectangle]);
    expect(fake.undoCommits).toBe(1);
  });

  it('places several images in a row with a gap', async () => {
    const fake = fakeFigma();
    await placeImages(api(fake), request({ images: [payload(512, 512), payload(512, 512)] }));
    const [first, second] = fake.page.children;
    expect(first).toMatchObject({ width: 512, height: 512, x: 500 - 532, y: 300 - 256 });
    expect(second!.x - first!.x).toBe(512 + 40);
  });

  it('keeps small images at their size', async () => {
    const fake = fakeFigma();
    await placeImages(api(fake), request({ images: [payload(300, 200)] }));
    expect(fake.page.children[0]).toMatchObject({ width: 300, height: 200 });
  });
});

describe('layerName', () => {
  it('uses the prompt, on one line and shortened at a word', () => {
    expect(layerName('  A ceramic cup\n on a table ')).toBe('A ceramic cup on a table');
    const long = 'A ceramic coffee cup on a linen table next to a window with soft morning light and plants';
    const name = layerName(long);
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith('…')).toBe(true);
    expect(long.startsWith(name.slice(0, -1))).toBe(true);
  });

  it('has a name for an empty prompt', () => {
    expect(layerName('   ')).toBe('Wiro AI image');
  });
});

describe('placedMessage', () => {
  it('says what happened', () => {
    expect(placedMessage({ filled: 1, created: 0, missing: 0 })).toBe('Filled 1 layer');
    expect(placedMessage({ filled: 3, created: 0, missing: 1 })).toBe('Filled 3 layers. 1 selected layer was gone');
    expect(placedMessage({ filled: 0, created: 2, missing: 0 })).toBe('Added 2 images');
  });
});

import { describe, expect, it } from 'vitest';
import {
  freeStart,
  insertText,
  layerName,
  PLUGIN_DATA_KEY,
  PlacementError,
  placedMessage,
  placeImages,
  placeSvg,
  rowBeside,
  sizeBeside,
  type PlaceImagesRequest,
  type PlacementApi,
} from '../../src/main/placement';
import { collectTextNodes, describeSelection, imagePaintOf, isFillable } from '../../src/main/selection';
import type { ImagePayload } from '../../src/shared/messages';
import { fakeFigma, fakeNode } from './fake-figma';

function payload(width: number, height: number, url = `https://cdn1.wiro.ai/x/${width}x${height}.png`): ImagePayload {
  return { bytes: new Uint8Array([1, 2, 3]), width, height, url };
}

function request(overrides: Partial<PlaceImagesRequest> = {}): PlaceImagesRequest {
  return {
    images: [payload(1024, 1024)],
    targetIds: [],
    mode: 'fill',
    scaleMode: 'FILL',
    name: 'A cup of coffee',
    model: 'google/nano-banana-2',
    taskId: '42',
    ...overrides,
  };
}

const api = (fake: ReturnType<typeof fakeFigma>) => fake.figma as unknown as PlacementApi;
const asBase = (node: unknown) => node as BaseNode;
const asScene = (nodes: unknown[]) => nodes as SceneNode[];

describe('selection', () => {
  it('accepts frames, shapes, text and instances with an area', () => {
    for (const type of ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'INSTANCE', 'COMPONENT', 'SECTION', 'VECTOR']) {
      expect(isFillable(asBase(fakeNode(type)))).toBe(true);
    }
  });

  it('skips groups, lines, slices and layers without an area', () => {
    expect(isFillable(asBase(fakeNode('GROUP', { noFills: true })))).toBe(false);
    expect(isFillable(asBase(fakeNode('SLICE', { noFills: true })))).toBe(false);
    expect(isFillable(asBase(fakeNode('LINE', { height: 0 })))).toBe(false);
    expect(isFillable(asBase(fakeNode('RECTANGLE', { width: 0 })))).toBe(false);
  });

  it('finds the visible image paint of a layer', () => {
    const image = { type: 'IMAGE', imageHash: 'h1', scaleMode: 'FILL' };
    expect(imagePaintOf(asBase(fakeNode('RECTANGLE', { fills: [{ type: 'SOLID' }, image] })))).toEqual(image);
    expect(imagePaintOf(asBase(fakeNode('RECTANGLE', { fills: [{ ...image, visible: false }] })))).toBeUndefined();
    expect(imagePaintOf(asBase(fakeNode('GROUP', { noFills: true })))).toBeUndefined();
  });

  it('lists the targets in order, marks images and counts text layers inside frames', () => {
    const hero = fakeNode('FRAME', {
      name: 'Hero',
      width: 1440,
      height: 900,
      fills: [{ type: 'IMAGE', imageHash: 'h' }],
    });
    const group = fakeNode('GROUP', { noFills: true });
    const card = fakeNode('FRAME', { name: 'Card' });
    card.appendChild!(fakeNode('TEXT', { characters: 'Title' }));
    card.appendChild!(fakeNode('TEXT', { characters: 'Body' }));
    const headline = fakeNode('TEXT', { name: 'Headline', characters: 'Hi' });
    const info = describeSelection(asScene([hero, group, card, headline]));
    expect(info.targets.map((target) => [target.name, target.hasImage])).toEqual([
      ['Hero', true],
      ['Card', false],
      ['Headline', false],
    ]);
    expect(info.skipped).toBe(1);
    expect(info.texts).toBe(3);
  });

  it('collects each text layer once, up to the limit', () => {
    const text = fakeNode('TEXT', { characters: 'Same' });
    const frame = fakeNode('FRAME');
    frame.appendChild!(text);
    expect(collectTextNodes(asScene([text, frame])).map((node) => node.id)).toEqual([text.id]);
    const many = fakeNode('FRAME');
    for (let index = 0; index < 5; index += 1) many.appendChild!(fakeNode('TEXT'));
    expect(collectTextNodes(asScene([many]), 3)).toHaveLength(3);
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
  });

  it('gives layer n image n and repeats the images when there are more layers', async () => {
    const layers = [fakeNode('FRAME'), fakeNode('FRAME'), fakeNode('FRAME')];
    const fake = fakeFigma(layers);
    await placeImages(
      api(fake),
      request({ images: [payload(512, 512), payload(512, 768)], targetIds: layers.map((node) => node.id) }),
    );
    expect(layers.map((node) => (node.fills as ImagePaint[])[0]!.imageHash)).toEqual(['hash-1', 'hash-2', 'hash-1']);
  });

  it('loads the fonts of text layers before filling them', async () => {
    const text = fakeNode('TEXT', { characters: 'Sale', fonts: [{ family: 'Inter', style: 'Bold' }] });
    const fake = fakeFigma([text]);
    await placeImages(api(fake), request({ targetIds: [text.id] }));
    expect(fake.loadedFonts).toEqual([{ family: 'Inter', style: 'Bold' }]);
    expect((text.fills as ImagePaint[])[0]!.type).toBe('IMAGE');
  });

  it('counts a layer that refuses the fill as missing and fills the rest', async () => {
    const good = fakeNode('RECTANGLE');
    const bad = fakeNode('RECTANGLE');
    Object.defineProperty(bad, 'fills', {
      get: () => [],
      set: () => {
        throw new Error('Cannot set fills');
      },
    });
    const fake = fakeFigma([bad, good]);
    const result = await placeImages(api(fake), request({ targetIds: [bad.id, good.id] }));
    expect(result).toEqual({ filled: 1, created: 0, missing: 1 });
  });

  it('skips deleted layers and refuses when every target is gone', async () => {
    const kept = fakeNode('RECTANGLE');
    const deleted = fakeNode('RECTANGLE', { removed: true });
    const fake = fakeFigma([kept, deleted]);
    expect(await placeImages(api(fake), request({ targetIds: [deleted.id, kept.id, 'gone:1'] }))).toEqual({
      filled: 1,
      created: 0,
      missing: 2,
    });
    const empty = fakeFigma([]);
    await expect(placeImages(api(empty), request({ targetIds: ['1:1'] }))).rejects.toBeInstanceOf(PlacementError);
    expect(empty.undoCommits).toBe(0);
  });

  it('refuses an empty request', async () => {
    await expect(placeImages(api(fakeFigma()), request({ images: [] }))).rejects.toThrow('no image');
  });
});

describe('placeImages into new layers', () => {
  it('adds one rectangle per image, sized to the image and centred in the view', async () => {
    const fake = fakeFigma();
    const result = await placeImages(api(fake), request({ images: [payload(2048, 1152)] }));
    expect(result).toEqual({ filled: 0, created: 1, missing: 0 });
    const [rectangle] = fake.page.children;
    expect(rectangle).toMatchObject({
      type: 'RECTANGLE',
      width: 1024,
      height: 576,
      name: 'A cup of coffee',
      x: -12,
      y: 12,
    });
    expect(fake.page.selection).toEqual([rectangle]);
    expect(fake.scrolledTo).toEqual([rectangle]);
  });

  it('puts results beside the anchor layer, at its height, in a row', async () => {
    const photo = fakeNode('FRAME', { name: 'Photo', x: 100, y: 200, width: 400, height: 600 });
    const fake = fakeFigma([photo]);
    await placeImages(
      api(fake),
      request({ mode: 'beside', anchorId: photo.id, images: [payload(1000, 1000), payload(1500, 1000)] }),
    );
    const added = fake.page.children.filter((node) => node.type === 'RECTANGLE');
    expect(added.map((node) => [node.x, node.y, node.width, node.height])).toEqual([
      [540, 200, 600, 600],
      [1180, 200, 900, 600],
    ]);
  });

  it('starts beside the last result in the same row, so results do not cover each other', async () => {
    const photo = fakeNode('FRAME', { x: 0, y: 0, width: 400, height: 400 });
    const earlier = fakeNode('RECTANGLE', { x: 440, y: 0, width: 400, height: 400 });
    const elsewhere = fakeNode('RECTANGLE', { x: 2000, y: 5000, width: 400, height: 400 });
    const fake = fakeFigma([photo, earlier, elsewhere]);
    await placeImages(api(fake), request({ mode: 'beside', anchorId: photo.id, images: [payload(400, 400)] }));
    const added = fake.page.children.at(-1)!;
    expect([added.x, added.y]).toEqual([880, 0]);
  });

  it('falls back to the centre of the view when the anchor is gone', async () => {
    const fake = fakeFigma();
    await placeImages(api(fake), request({ mode: 'beside', anchorId: 'gone:1', images: [payload(300, 200)] }));
    expect(fake.page.children[0]).toMatchObject({ width: 300, height: 200 });
  });
});

describe('row helpers', () => {
  it('sizes a result beside a box within limits', () => {
    expect(sizeBeside({ x: 0, y: 0, width: 50, height: 50 }, { width: 200, height: 100 })).toEqual({
      width: 512,
      height: 256,
    });
    expect(sizeBeside({ x: 0, y: 0, width: 50, height: 3000 }, { width: 100, height: 100 })).toEqual({
      width: 1024,
      height: 1024,
    });
  });

  it('finds free space only among layers in the same band, to the right', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    expect(freeStart(box, 100, [{ x: -500, y: 0, width: 100, height: 100 }])).toBe(140);
    expect(freeStart(box, 100, [{ x: 140, y: 500, width: 100, height: 100 }])).toBe(140);
    expect(freeStart(box, 100, [{ x: 140, y: 50, width: 100, height: 100 }])).toBe(280);
    expect(rowBeside(box, [{ width: 10, height: 10 }], 40, 500)).toEqual([{ x: 500, y: 0 }]);
  });
});

describe('placeSvg and insertText', () => {
  it('adds the SVG as a vector frame, scaled to 512 px, beside the anchor', async () => {
    const anchor = fakeNode('FRAME', { x: 0, y: 0, width: 200, height: 200 });
    const fake = fakeFigma([anchor]);
    const result = await placeSvg(api(fake), {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"></svg>',
      name: 'Paper plane',
      anchorId: anchor.id,
      model: 'openai/gpt-image-2-6-flare-custom',
      taskId: '7',
    });
    expect(result).toEqual({ created: 1 });
    const frame = fake.page.children.at(-1)!;
    expect(frame).toMatchObject({ name: 'Paper plane', width: 512, height: 512, x: 240, y: 0 });
    expect(JSON.parse(frame.pluginData[PLUGIN_DATA_KEY]!)).toEqual({
      model: 'openai/gpt-image-2-6-flare-custom',
      taskId: '7',
    });
    expect(fake.undoCommits).toBe(1);
  });

  it('explains an SVG Figma cannot read', async () => {
    await expect(placeSvg(api(fakeFigma()), { svg: 'not svg', name: 'x', model: 'm/x' })).rejects.toThrow(
      'could not read the SVG',
    );
  });

  it('adds a text layer with Inter loaded first', async () => {
    const fake = fakeFigma();
    await insertText(api(fake), { text: 'Plan smarter. Travel better.', name: 'Tagline' });
    const text = fake.page.children.at(-1)!;
    expect(text).toMatchObject({
      type: 'TEXT',
      characters: 'Plan smarter. Travel better.',
      name: 'Tagline',
      width: 400,
    });
    expect(fake.loadedFonts).toEqual([{ family: 'Inter', style: 'Regular' }]);
  });
});

describe('names and notices', () => {
  it('names new layers after the prompt, shortened at a word', () => {
    expect(layerName('  A ceramic cup\n on a table ')).toBe('A ceramic cup on a table');
    const long = 'A ceramic coffee cup on a linen table next to a window with soft morning light and plants';
    const name = layerName(long);
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith('…')).toBe(true);
    expect(layerName('   ')).toBe('Wiro AI image');
  });

  it('says what happened', () => {
    expect(placedMessage({ filled: 1, created: 0, missing: 0 })).toBe('Filled 1 layer');
    expect(placedMessage({ filled: 3, created: 0, missing: 1 })).toBe('Filled 3 layers. 1 selected layer was gone');
    expect(placedMessage({ filled: 0, created: 2, missing: 0 })).toBe('Added 2 images');
  });
});

import { describe, expect, it } from 'vitest';
import { exportSelection, readTexts, setTexts, type ReadWriteApi } from '../../src/main/export';
import { fakeFigma, fakeNode } from './fake-figma';

const asScene = (nodes: unknown[]) => nodes as SceneNode[];

describe('exportSelection', () => {
  it('gives a layer that shows an image its own image at full size', async () => {
    const fake = fakeFigma();
    const image = fake.figma.createImage(new Uint8Array([9, 9, 9]));
    const photo = fakeNode('FRAME', {
      name: 'Photo',
      width: 300,
      height: 300,
      fills: [{ type: 'IMAGE', imageHash: image.hash }],
    });
    const [exported] = await exportSelection(fake.figma as unknown as ReadWriteApi, asScene([photo]), 2048, 1);
    expect(exported).toEqual({
      id: photo.id,
      name: 'Photo',
      bytes: new Uint8Array([9, 9, 9]),
      width: 640,
      height: 480,
      source: 'fill',
    });
  });

  it('draws other layers as PNG, at most maxSide and at most twice their size', async () => {
    const fake = fakeFigma();
    const big = fakeNode('FRAME', { width: 4000, height: 2000 });
    const small = fakeNode('FRAME', { width: 100, height: 50 });
    const group = fakeNode('GROUP', { noFills: true, width: 300, height: 300 });
    const exported = await exportSelection(
      fake.figma as unknown as ReadWriteApi,
      asScene([big, small, group]),
      2048,
      3,
    );
    expect(exported.map((image) => [image.width, image.height, image.source])).toEqual([
      [2048, 1024, 'render'],
      [200, 100, 'render'],
      [600, 600, 'render'],
    ]);
  });

  it('stops at the limit', async () => {
    const fake = fakeFigma();
    const exported = await exportSelection(
      fake.figma as unknown as ReadWriteApi,
      asScene([fakeNode('FRAME'), fakeNode('FRAME'), fakeNode('FRAME')]),
      2048,
      2,
    );
    expect(exported).toHaveLength(2);
  });
});

describe('readTexts and setTexts', () => {
  it('reads the text layers of the selection', () => {
    const card = fakeNode('FRAME');
    card.appendChild!(fakeNode('TEXT', { name: 'Title', characters: 'Plan your trip' }));
    expect(readTexts(asScene([card]), 10)).toEqual([
      { id: card.children[0]!.id, name: 'Title', characters: 'Plan your trip' },
    ]);
  });

  it('loads each font, replaces the text and makes one undo step', async () => {
    const title = fakeNode('TEXT', { characters: 'Old', fonts: [{ family: 'Inter', style: 'Bold' }] });
    const body = fakeNode('TEXT', { characters: 'Old body' });
    const fake = fakeFigma([title, body]);
    const result = await setTexts(fake.figma as unknown as ReadWriteApi, [
      { id: title.id, text: 'New' },
      { id: body.id, text: 'New body' },
    ]);
    expect(result).toEqual({ updated: 2, failed: [] });
    expect([title.characters, body.characters]).toEqual(['New', 'New body']);
    expect(fake.loadedFonts).toEqual([
      { family: 'Inter', style: 'Bold' },
      { family: 'Inter', style: 'Regular' },
    ]);
    expect(fake.undoCommits).toBe(1);
  });

  it('reports layers that are gone or use a missing font, and changes nothing else', async () => {
    const missingFont = fakeNode('TEXT', { name: 'Fancy', characters: 'Keep', hasMissingFont: true });
    const fake = fakeFigma([missingFont]);
    const result = await setTexts(fake.figma as unknown as ReadWriteApi, [
      { id: missingFont.id, text: 'Changed' },
      { id: 'gone:1', text: 'x' },
    ]);
    expect(result.updated).toBe(0);
    expect(result.failed.map((failure) => failure.reason)).toEqual([
      'It uses a font that is not installed.',
      'The text layer is gone.',
    ]);
    expect(missingFont.characters).toBe('Keep');
    expect(fake.undoCommits).toBe(0);
  });
});

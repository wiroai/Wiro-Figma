import type { ExportedImage, SetTextResult, TextItem } from '../shared/messages';
import { collectTextNodes, imagePaintOf } from './selection';

// Reading the selection for actions that send it to a model (images, text)
// and writing text back.

/** The part of the plugin API these helpers use. `figma` itself satisfies it. */
export interface ReadWriteApi {
  getImageByHash(hash: string): Image | null;
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
  loadFontAsync(font: FontName): Promise<void>;
  commitUndo(): void;
}

/**
 * The selected layers as images, up to `limit`. A layer that shows an image
 * gives that image at its own size; any other layer is drawn as PNG, at most
 * `maxSide` px on its longer side and at most twice its size on the canvas.
 */
export async function exportSelection(
  api: Pick<ReadWriteApi, 'getImageByHash'>,
  selection: readonly SceneNode[],
  maxSide: number,
  limit: number,
): Promise<ExportedImage[]> {
  const images: ExportedImage[] = [];
  for (const node of selection) {
    if (images.length >= limit) break;
    const paint = imagePaintOf(node);
    if (paint) {
      const image = api.getImageByHash(paint.imageHash!);
      if (image) {
        const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
        images.push({ id: node.id, name: node.name, bytes, width: size.width, height: size.height, source: 'fill' });
        continue;
      }
    }
    if (!('exportAsync' in node) || !('width' in node) || !(node.width > 0) || !(node.height > 0)) continue;
    const scale = Math.min(2, maxSide / Math.max(node.width, node.height));
    const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    images.push({
      id: node.id,
      name: node.name,
      bytes,
      width: Math.max(1, Math.round(node.width * scale)),
      height: Math.max(1, Math.round(node.height * scale)),
      source: 'render',
    });
  }
  return images;
}

export function readTexts(selection: readonly SceneNode[], limit: number): TextItem[] {
  return collectTextNodes(selection, limit).map((node) => ({
    id: node.id,
    name: node.name,
    characters: node.characters,
  }));
}

/** The fonts a text layer uses, so they can be loaded before its text changes. */
export function fontsOf(node: TextNode): FontName[] {
  if (node.characters.length > 0) return node.getRangeAllFontNames(0, node.characters.length);
  // figma.mixed is a symbol; a single font is an object.
  return typeof node.fontName === 'object' ? [node.fontName] : [];
}

/**
 * Replaces the text of text layers. Each layer keeps the style of its first
 * character. A layer that is gone, or uses a font that is not installed, is
 * reported and left as it was.
 */
export async function setTexts(
  api: ReadWriteApi,
  items: ReadonlyArray<{ id: string; text: string }>,
  fonts: (node: TextNode) => FontName[] = fontsOf,
): Promise<SetTextResult> {
  const result: SetTextResult = { updated: 0, failed: [] };
  for (const item of items) {
    const node = await api.getNodeByIdAsync(item.id);
    if (!node || node.removed || node.type !== 'TEXT') {
      result.failed.push({ id: item.id, name: node?.name ?? item.id, reason: 'The text layer is gone.' });
      continue;
    }
    if (node.hasMissingFont) {
      result.failed.push({ id: node.id, name: node.name, reason: 'It uses a font that is not installed.' });
      continue;
    }
    try {
      await Promise.all(fonts(node).map((font) => api.loadFontAsync(font)));
      node.characters = item.text;
      result.updated += 1;
    } catch (error) {
      result.failed.push({
        id: node.id,
        name: node.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (result.updated > 0) api.commitUndo();
  return result;
}

import type { SelectionInfo, SelectionTarget } from '../shared/messages';

// What the selection holds: layers that take an image fill, layers that
// already show an image, and text layers.

/** A layer with a `fills` property that holds an image. */
export type FillableNode = SceneNode & MinimalFillsMixin & DimensionAndPositionMixin;

/** At most this many text layers are counted or read at once. */
export const TEXT_LIMIT = 200;

/**
 * True for layers that show an image fill: frames, shapes, text, components,
 * instances, sections and so on. Lines have fills but no area, and layers with
 * no width or height would show nothing.
 */
export function isFillable(node: BaseNode): node is FillableNode {
  if (!('fills' in node) || node.type === 'LINE') return false;
  if (!('width' in node) || !('height' in node)) return false;
  const { width, height } = node as unknown as DimensionAndPositionMixin;
  return width > 0 && height > 0;
}

/** The first visible image paint of a layer, if it has one. */
export function imagePaintOf(node: BaseNode): ImagePaint | undefined {
  if (!('fills' in node)) return undefined;
  const fills = (node as MinimalFillsMixin).fills;
  if (!Array.isArray(fills)) return undefined;
  return (fills as readonly Paint[]).find(
    (paint): paint is ImagePaint => paint.type === 'IMAGE' && paint.visible !== false && !!paint.imageHash,
  );
}

function size(node: SceneNode): { width: number; height: number } {
  return 'width' in node && 'height' in node ? { width: node.width, height: node.height } : { width: 0, height: 0 };
}

/** Text layers in the selection, in order: selected ones and those inside selected frames or groups. */
export function collectTextNodes(selection: readonly SceneNode[], limit = TEXT_LIMIT): TextNode[] {
  const found: TextNode[] = [];
  const seen = new Set<string>();
  const add = (node: TextNode) => {
    if (found.length < limit && !seen.has(node.id)) {
      seen.add(node.id);
      found.push(node);
    }
  };
  for (const node of selection) {
    if (found.length >= limit) break;
    if (node.type === 'TEXT') add(node);
    else if ('findAllWithCriteria' in node) {
      for (const text of (node as ChildrenMixin).findAllWithCriteria({ types: ['TEXT'] })) add(text);
    }
  }
  return found;
}

export function describeSelection(selection: readonly SceneNode[]): SelectionInfo {
  const targets: SelectionTarget[] = [];
  let skipped = 0;
  for (const node of selection) {
    if (isFillable(node)) {
      const { width, height } = size(node);
      targets.push({ id: node.id, name: node.name, type: node.type, width, height, hasImage: !!imagePaintOf(node) });
    } else {
      skipped += 1;
    }
  }
  return { targets, skipped, texts: collectTextNodes(selection).length };
}

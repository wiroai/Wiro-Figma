import type { SelectionInfo, SelectionTarget } from '../shared/messages';

// Which selected layers can take an image fill.

/** A layer with a `fills` property that holds an image. */
export type FillableNode = SceneNode & MinimalFillsMixin & DimensionAndPositionMixin;

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

export function describeSelection(selection: readonly SceneNode[]): SelectionInfo {
  const targets: SelectionTarget[] = [];
  let skipped = 0;
  for (const node of selection) {
    if (isFillable(node)) {
      targets.push({ id: node.id, name: node.name, type: node.type, width: node.width, height: node.height });
    } else {
      skipped += 1;
    }
  }
  return { targets, skipped };
}

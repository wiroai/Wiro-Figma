import { fitWithin, layoutRow, NEW_LAYER_GAP, NEW_LAYER_LONG_SIDE, type Point, type Size } from '../shared/geometry';
import type { PlaceResult, Request } from '../shared/messages';
import { fontsOf } from './export';
import { isFillable } from './selection';

// Puts results on the canvas: images as the fill of the layers that were
// selected when the run started, or in new rectangles; SVG as vector layers;
// text as a new text layer.

/** The part of the plugin API placement uses. `figma` itself satisfies it. */
export interface PlacementApi {
  createImage(data: Uint8Array): Image;
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
  createRectangle(): RectangleNode;
  createNodeFromSvg(svg: string): FrameNode;
  createText(): TextNode;
  loadFontAsync(font: FontName): Promise<void>;
  readonly currentPage: PageNode;
  readonly viewport: { readonly center: Vector; scrollAndZoomIntoView(nodes: readonly BaseNode[]): void };
  commitUndo(): void;
}

export type PlaceImagesRequest = Omit<Extract<Request, { kind: 'place' }>, 'kind'>;

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}

/** Plugin data kept on each layer that gets a result, under this key. */
export const PLUGIN_DATA_KEY = 'wiro';

/** New layers placed beside a layer are this tall, within these limits. */
const BESIDE_MIN_HEIGHT = 256;
const BESIDE_MAX_HEIGHT = 1024;

/** SVG results are scaled down to this size on their longer side. */
export const SVG_LONG_SIDE = 512;

const TEXT_FONT: FontName = { family: 'Inter', style: 'Regular' };

function imagePaint(imageHash: string, scaleMode: PlaceImagesRequest['scaleMode']): ImagePaint {
  return { type: 'IMAGE', imageHash, scaleMode };
}

function provenance(model: string, url: string | undefined, taskId: string | undefined): string {
  const data: Record<string, string> = { model };
  if (url) data.url = url;
  if (taskId) data.taskId = taskId;
  return JSON.stringify(data);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The anchor layer's box on the page, or undefined when it is gone. */
async function anchorBox(api: PlacementApi, anchorId: string | undefined): Promise<Box | undefined> {
  if (!anchorId) return undefined;
  const node = await api.getNodeByIdAsync(anchorId);
  if (!node || node.removed || !('absoluteBoundingBox' in node)) return undefined;
  const box = (node as SceneNode & { absoluteBoundingBox: Rect | null }).absoluteBoundingBox;
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : undefined;
}

/**
 * Where a row beside a box can start: right of the box, and right of any
 * layer already there in the same band, so new results do not cover old ones.
 */
export function freeStart(box: Box, height: number, others: readonly Box[], gap = NEW_LAYER_GAP): number {
  let x = box.x + box.width + gap;
  const top = box.y;
  const bottom = box.y + Math.max(height, 1);
  for (const other of others) {
    const overlapsBand = other.y < bottom && other.y + other.height > top;
    const toTheRight = other.x + other.width > box.x + box.width;
    if (overlapsBand && toTheRight) x = Math.max(x, other.x + other.width + gap);
  }
  return x;
}

/** The boxes of the page's top-level layers, for finding free space. */
function pageBoxes(api: PlacementApi, skip: string | undefined): Box[] {
  const boxes: Box[] = [];
  for (const node of api.currentPage.children) {
    if (node.id === skip || !('absoluteBoundingBox' in node)) continue;
    const box = (node as SceneNode & { absoluteBoundingBox: Rect | null }).absoluteBoundingBox;
    if (box) boxes.push({ x: box.x, y: box.y, width: box.width, height: box.height });
  }
  return boxes;
}

/** Top-left corners for a row of sizes that starts at `startX`, top-aligned with the box. */
export function rowBeside(box: Box, sizes: readonly Size[], gap = NEW_LAYER_GAP, startX?: number): Point[] {
  let x = startX ?? box.x + box.width + gap;
  return sizes.map((size) => {
    const point = { x: Math.round(x), y: Math.round(box.y) };
    x += size.width + gap;
    return point;
  });
}

/** The size of a new layer beside a box: the box's height within limits, the image's shape. */
export function sizeBeside(box: Box, image: Size): Size {
  const height = Math.max(BESIDE_MIN_HEIGHT, Math.min(BESIDE_MAX_HEIGHT, box.height));
  const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  return { width: Math.max(1, Math.round(height * ratio)), height: Math.round(height) };
}

/**
 * Places images. In "fill" mode with target layers, layer n gets image n, and
 * the images repeat when there are more layers than images. Otherwise each
 * image gets a new rectangle: beside the anchor layer in "beside" mode, or in
 * a row at the centre of the view, sized to the image (at most
 * NEW_LAYER_LONG_SIDE on its longer side).
 */
export async function placeImages(api: PlacementApi, request: PlaceImagesRequest): Promise<PlaceResult> {
  if (request.images.length === 0) throw new PlacementError('There is no image to place.');
  const images = request.images.map((payload) => ({ payload, image: api.createImage(payload.bytes) }));

  if (request.mode === 'fill' && request.targetIds.length > 0) {
    let filled = 0;
    let missing = 0;
    for (const id of request.targetIds) {
      const node = await api.getNodeByIdAsync(id);
      if (!node || node.removed || !isFillable(node)) {
        missing += 1;
        continue;
      }
      const { payload, image } = images[filled % images.length]!;
      try {
        // Text layers need their fonts loaded before their fills change.
        if (node.type === 'TEXT') await Promise.all(fontsOf(node).map((font) => api.loadFontAsync(font)));
        node.fills = [imagePaint(image.hash, request.scaleMode)];
        node.setPluginData(PLUGIN_DATA_KEY, provenance(request.model, payload.url, request.taskId));
        filled += 1;
      } catch {
        missing += 1;
      }
    }
    if (filled === 0) {
      throw new PlacementError(
        'The selected layers are gone or could not take the image, so it was not placed. It is in Recent: select a layer and click it there.',
      );
    }
    api.commitUndo();
    return { filled, created: 0, missing };
  }

  const box = request.mode === 'beside' ? await anchorBox(api, request.anchorId) : undefined;
  const sizes: Size[] = images.map(({ payload }) =>
    box
      ? sizeBeside(box, { width: payload.width, height: payload.height })
      : fitWithin({ width: payload.width, height: payload.height }, NEW_LAYER_LONG_SIDE),
  );
  const rowHeight = Math.max(0, ...sizes.map((size) => size.height));
  const corners = box
    ? rowBeside(box, sizes, NEW_LAYER_GAP, freeStart(box, rowHeight, pageBoxes(api, request.anchorId)))
    : layoutRow(sizes, api.viewport.center, NEW_LAYER_GAP);
  const created: RectangleNode[] = images.map(({ payload, image }, index) => {
    const rectangle = api.createRectangle();
    const size = sizes[index]!;
    const corner = corners[index]!;
    rectangle.resize(size.width, size.height);
    rectangle.x = corner.x;
    rectangle.y = corner.y;
    rectangle.name = request.name;
    rectangle.fills = [imagePaint(image.hash, request.scaleMode)];
    rectangle.setPluginData(PLUGIN_DATA_KEY, provenance(request.model, payload.url, request.taskId));
    api.currentPage.appendChild(rectangle);
    return rectangle;
  });
  api.currentPage.selection = created;
  api.viewport.scrollAndZoomIntoView(created);
  api.commitUndo();
  return { filled: 0, created: created.length, missing: 0 };
}

/** Puts an SVG on the canvas as vector layers, beside the anchor layer or at the centre of the view. */
export async function placeSvg(
  api: PlacementApi,
  request: Omit<Extract<Request, { kind: 'place-svg' }>, 'kind'>,
): Promise<{ created: number }> {
  let frame: FrameNode;
  try {
    frame = api.createNodeFromSvg(request.svg);
  } catch (error) {
    throw new PlacementError(
      `Figma could not read the SVG the model returned: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  frame.name = request.name;
  const longest = Math.max(frame.width, frame.height);
  if (longest > SVG_LONG_SIDE) frame.rescale(SVG_LONG_SIDE / longest);
  const box = await anchorBox(api, request.anchorId);
  const others = pageBoxes(api, frame.id);
  const corner = box
    ? rowBeside(
        box,
        [{ width: frame.width, height: frame.height }],
        NEW_LAYER_GAP,
        freeStart(box, frame.height, others),
      )[0]!
    : layoutRow([{ width: frame.width, height: frame.height }], api.viewport.center, 0)[0]!;
  frame.x = corner.x;
  frame.y = corner.y;
  frame.setPluginData(PLUGIN_DATA_KEY, provenance(request.model, undefined, request.taskId));
  api.currentPage.appendChild(frame);
  api.currentPage.selection = [frame];
  api.viewport.scrollAndZoomIntoView([frame]);
  api.commitUndo();
  return { created: 1 };
}

/** Adds a text layer with the given text, beside the anchor layer or at the centre of the view. */
export async function insertText(
  api: PlacementApi,
  request: Omit<Extract<Request, { kind: 'insert-text' }>, 'kind'>,
): Promise<{ created: number }> {
  await api.loadFontAsync(TEXT_FONT);
  const text = api.createText();
  text.fontName = TEXT_FONT;
  text.fontSize = 16;
  text.characters = request.text;
  text.name = request.name;
  text.resize(400, text.height);
  text.textAutoResize = 'HEIGHT';
  const box = await anchorBox(api, request.anchorId);
  const corner = box
    ? rowBeside(
        box,
        [{ width: 400, height: text.height }],
        NEW_LAYER_GAP,
        freeStart(box, text.height, pageBoxes(api, text.id)),
      )[0]!
    : layoutRow([{ width: 400, height: text.height }], api.viewport.center, 0)[0]!;
  text.x = corner.x;
  text.y = corner.y;
  api.currentPage.appendChild(text);
  api.currentPage.selection = [text];
  api.viewport.scrollAndZoomIntoView([text]);
  api.commitUndo();
  return { created: 1 };
}

/** The layer name for new layers: the prompt, shortened. */
export function layerName(prompt: string, max = 60): string {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text) return 'Wiro AI image';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/\s+$/, '')}…`;
}

/** The notice shown after placing. */
export function placedMessage(result: PlaceResult): string {
  const parts: string[] = [];
  if (result.filled > 0) parts.push(`Filled ${result.filled} ${result.filled === 1 ? 'layer' : 'layers'}`);
  if (result.created > 0) parts.push(`Added ${result.created} ${result.created === 1 ? 'image' : 'images'}`);
  let message = parts.join(', ') || 'Nothing was placed';
  if (result.missing > 0) {
    message += `. ${result.missing} selected ${result.missing === 1 ? 'layer was' : 'layers were'} gone`;
  }
  return message;
}

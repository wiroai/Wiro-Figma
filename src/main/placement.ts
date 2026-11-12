import { fitWithin, layoutRow, NEW_LAYER_GAP, NEW_LAYER_LONG_SIDE, type Size } from '../shared/geometry';
import type { PlaceRequest, PlaceResult } from '../shared/messages';
import { isFillable } from './selection';

// Puts generated images on the canvas: as the fill of the layers that were
// selected when the run started, or in new rectangles when nothing was.

/** The part of the plugin API placement uses. `figma` itself satisfies it. */
export interface PlacementApi {
  createImage(data: Uint8Array): Image;
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
  createRectangle(): RectangleNode;
  readonly currentPage: PageNode;
  readonly viewport: { readonly center: Vector; scrollAndZoomIntoView(nodes: readonly BaseNode[]): void };
  commitUndo(): void;
}

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}

/** Plugin data kept on each layer that gets an image, under this key. */
export const PLUGIN_DATA_KEY = 'wiro';

function imagePaint(imageHash: string, scaleMode: PlaceRequest['scaleMode']): ImagePaint {
  return { type: 'IMAGE', imageHash, scaleMode };
}

function provenance(request: PlaceRequest, url: string): string {
  const data: Record<string, string> = { model: request.model, url };
  if (request.taskId) data.taskId = request.taskId;
  return JSON.stringify(data);
}

/**
 * Places the images. With target layers, layer n gets image n, and the images
 * repeat when there are more layers than images. Without targets, each image
 * gets a new rectangle, sized to the image (at most NEW_LAYER_LONG_SIDE on its
 * longer side) and placed in a row at the centre of the view.
 */
export async function placeImages(api: PlacementApi, request: PlaceRequest): Promise<PlaceResult> {
  if (request.images.length === 0) throw new PlacementError('There is no image to place.');
  const images = request.images.map((payload) => ({ payload, image: api.createImage(payload.bytes) }));

  if (request.targetIds.length > 0) {
    let filled = 0;
    let missing = 0;
    for (const id of request.targetIds) {
      const node = await api.getNodeByIdAsync(id);
      if (!node || node.removed || !isFillable(node)) {
        missing += 1;
        continue;
      }
      const { payload, image } = images[filled % images.length]!;
      node.fills = [imagePaint(image.hash, request.scaleMode)];
      node.setPluginData(PLUGIN_DATA_KEY, provenance(request, payload.url));
      filled += 1;
    }
    if (filled === 0) {
      throw new PlacementError(
        'The layers that were selected are gone, so the image was not placed. Select a layer and use Place on the image.',
      );
    }
    api.commitUndo();
    return { filled, created: 0, missing };
  }

  const sizes: Size[] = images.map(({ payload }) =>
    fitWithin({ width: payload.width, height: payload.height }, NEW_LAYER_LONG_SIDE),
  );
  const corners = layoutRow(sizes, api.viewport.center, NEW_LAYER_GAP);
  const created: RectangleNode[] = images.map(({ payload, image }, index) => {
    const rectangle = api.createRectangle();
    const size = sizes[index]!;
    const corner = corners[index]!;
    rectangle.resize(size.width, size.height);
    rectangle.x = corner.x;
    rectangle.y = corner.y;
    rectangle.name = request.name;
    rectangle.fills = [imagePaint(image.hash, request.scaleMode)];
    rectangle.setPluginData(PLUGIN_DATA_KEY, provenance(request, payload.url));
    api.currentPage.appendChild(rectangle);
    return rectangle;
  });
  api.currentPage.selection = created;
  api.viewport.scrollAndZoomIntoView(created);
  api.commitUndo();
  return { filled: 0, created: created.length, missing: 0 };
}

/** The layer name for new rectangles: the prompt, shortened. */
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

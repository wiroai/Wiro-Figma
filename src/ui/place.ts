import type { RecentImage } from '../shared/messages';
import { fetchSvg, prepareImage } from './images';
import { scaleModeOf, type AppContext } from './state';

// Putting results on the canvas through the main thread.

export interface Placement {
  /** "fill": the target layers get the images; "beside": new layers next to the anchor. */
  mode: 'fill' | 'beside';
  targetIds: string[];
  anchorId?: string;
}

/** Most layers and images one placement takes (the main thread's limits). */
const MAX_TARGETS = 500;
const MAX_IMAGES = 16;

/**
 * Places image and vector results: pictures through figma.createImage, SVG as
 * vector layers beside the anchor (or the first target). The fit (Fill or Fit)
 * is read when the images are placed, so a change during the run counts.
 */
export async function placeResults(
  app: AppContext,
  results: readonly RecentImage[],
  placement: Placement,
  meta: { name: string; model: string; taskId?: string },
): Promise<number> {
  let placed = 0;
  const pictures = results.filter((result) => result.kind !== 'svg').slice(0, MAX_IMAGES);
  const vectors = results.filter((result) => result.kind === 'svg');
  if (pictures.length > 0) {
    const payloads = await Promise.all(pictures.map((picture) => prepareImage(picture.url)));
    const result = await app.services.bridge.request({
      kind: 'place',
      images: payloads,
      targetIds: placement.targetIds.slice(0, MAX_TARGETS),
      mode: placement.mode,
      anchorId: placement.anchorId,
      scaleMode: scaleModeOf(app.latestPreferences()),
      name: meta.name,
      model: meta.model,
      taskId: meta.taskId,
    });
    placed += result.filled + result.created;
  }
  for (const vector of vectors) {
    const svg = await fetchSvg(vector.url);
    await app.services.bridge.request({
      kind: 'place-svg',
      svg,
      name: meta.name,
      anchorId: placement.anchorId ?? placement.targetIds[0],
      model: meta.model,
      taskId: meta.taskId,
    });
    placed += 1;
  }
  return placed;
}

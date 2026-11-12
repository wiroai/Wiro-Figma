import type { RecentImage } from '../shared/messages';
import { taskCost } from './format';
import type { TaskResult } from './types';

/** How many finished images the Recent list keeps. */
export const RECENT_LIMIT = 24;

/** The image outputs of a finished task, as entries for the Recent list. */
export function recentFrom(result: TaskResult, model: string, prompt: string, now = Date.now()): RecentImage[] {
  const outputs = result.outputs.filter(
    (output) => output.kind === 'image' && typeof output.url === 'string' && output.url.startsWith('https://'),
  );
  const cost = taskCost(result);
  return outputs.map((output, index) => {
    const image: RecentImage = { url: output.url!, model, prompt, createdAt: now };
    if (result.task.id) image.taskId = result.task.id;
    // The task's cost is kept once, on its first image.
    if (index === 0 && cost !== undefined) image.costUsd = cost;
    return image;
  });
}

/** New images first, then the older ones, without repeats, at most RECENT_LIMIT. */
export function mergeRecent(added: readonly RecentImage[], existing: readonly RecentImage[]): RecentImage[] {
  const urls = new Set(added.map((image) => image.url));
  return [...added, ...existing.filter((image) => !urls.has(image.url))].slice(0, RECENT_LIMIT);
}

/** A short reason when a finished task has no image to place. */
export function noImageReason(result: TaskResult): string {
  if (result.state === 'cancelled') return 'The run was cancelled.';
  if (result.state === 'failed') return result.error || 'The model could not make this image.';
  const said = result.response?.trim() || result.outputs.find((output) => output.text)?.text?.trim();
  return said ? `The model returned no image: ${said}` : 'The model finished without an image.';
}

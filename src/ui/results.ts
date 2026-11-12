import type { RecentImage } from '../shared/messages';
import { taskCost } from './format';
import type { TaskOutput, TaskResult } from './types';

/** How many finished images the Recent list keeps. */
export const RECENT_LIMIT = 24;

const isSvg = (output: TaskOutput) => /svg/i.test(output.mimeType) || /\.svg(\?|$)/i.test(output.url ?? '');
const isHttps = (output: TaskOutput) => typeof output.url === 'string' && output.url.startsWith('https://');

/** Image outputs that are pictures (PNG, JPEG, WebP, GIF), not vectors. */
export function imageOutputs(result: TaskResult): TaskOutput[] {
  return result.outputs.filter((output) => output.kind === 'image' && isHttps(output) && !isSvg(output));
}

/** SVG outputs. */
export function svgOutputs(result: TaskResult): TaskOutput[] {
  return result.outputs.filter((output) => isHttps(output) && isSvg(output));
}

const isTextFile = (output: TaskOutput) =>
  isHttps(output) && output.text === undefined && (output.kind === 'text' || /^text\/|json/i.test(output.mimeType));

/** Files the plugin cannot put on the canvas (video, audio, 3D, documents), as links. */
export function otherOutputs(result: TaskResult): TaskOutput[] {
  return result.outputs.filter(
    (output) => isHttps(output) && output.kind !== 'image' && !isSvg(output) && !isTextFile(output),
  );
}

/** Text the task returned inline: an LLM's answer. */
export function inlineText(result: TaskResult): string | undefined {
  const text = result.outputs
    .filter((output) => output.kind === 'text' && typeof output.text === 'string')
    .map((output) => output.text!.trim())
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

/**
 * The text a task answered, without downloading anything: inline text, or
 * the response when the task has no file outputs (for other models the
 * response is the worker's log).
 */
export function textAnswer(result: TaskResult): string | undefined {
  const inline = inlineText(result);
  if (inline) return stripThinking(inline) || undefined;
  if (result.outputs.some(isHttps)) return undefined;
  return stripThinking(result.response ?? '') || undefined;
}

/** At most this much text is read from one output file. */
const MAX_TEXT_FILE = 200_000;

/** The text a task answered, reading text output files (such as output.txt) when there are any. */
export async function readAnswer(
  result: TaskResult,
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<string | undefined> {
  const quick = textAnswer(result);
  if (quick) return quick;
  const parts: string[] = [];
  for (const output of result.outputs.filter(isTextFile).slice(0, 3)) {
    if (typeof output.sizeBytes === 'number' && output.sizeBytes > MAX_TEXT_FILE) continue;
    try {
      const response = await fetchImpl(output.url!);
      if (response.ok) parts.push((await response.text()).slice(0, MAX_TEXT_FILE).trim());
    } catch {
      // A file that cannot be read is left out.
    }
  }
  return stripThinking(parts.filter(Boolean).join('\n\n')) || undefined;
}

/** A model's answer without its <think> section, when the section is closed. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** The image and vector outputs of a finished task, as entries for the Recent list. */
export function recentFrom(result: TaskResult, model: string, prompt: string, now = Date.now()): RecentImage[] {
  const cost = taskCost(result);
  const pictures = imageOutputs(result).map((output) => ({ output, svg: false }));
  const vectors = svgOutputs(result).map((output) => ({ output, svg: true }));
  return [...pictures, ...vectors].map(({ output, svg }, index) => {
    const image: RecentImage = { url: output.url!, model, prompt, createdAt: now };
    if (svg) image.kind = 'svg';
    if (result.task.id) image.taskId = result.task.id;
    // The task's cost is kept once, on its first result.
    if (index === 0 && cost !== undefined) image.costUsd = cost;
    return image;
  });
}

/** New images first, then the older ones, without repeats, at most RECENT_LIMIT. */
export function mergeRecent(added: readonly RecentImage[], existing: readonly RecentImage[]): RecentImage[] {
  const urls = new Set(added.map((image) => image.url));
  return [...added, ...existing.filter((image) => !urls.has(image.url))].slice(0, RECENT_LIMIT);
}

function short(text: string, max = 300): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The model's own error line, such as "Error: This model is temporarily unavailable." */
export function modelError(result: TaskResult): string | undefined {
  if (result.error?.trim()) return short(result.error);
  const said = textAnswer(result) ?? '';
  const line = said.split('\n').find((entry) => /^\s*error\b[:\s]/i.test(entry));
  return line ? short(line.replace(/^\s*error\s*:?\s*/i, '')) : undefined;
}

/** A short reason when a finished task has nothing the action can use. */
export function noResultReason(result: TaskResult, wanted: 'image' | 'svg' | 'text'): string {
  if (result.state === 'cancelled') return 'The run was cancelled.';
  if (result.state === 'failed') {
    const reason = modelError(result);
    return reason ? `The model could not do this: ${reason}` : 'The model could not do this.';
  }
  const said = textAnswer(result);
  const thing = wanted === 'svg' ? 'a vector' : wanted === 'text' ? 'any text' : 'an image';
  return said && wanted !== 'text'
    ? `The model returned no ${thing.replace(/^an? /, '')}: ${short(said)}`
    : `The model finished without ${thing}.`;
}

import { AuthError, McpError } from './mcp';
import type { ModelSummary, TaskResult } from './types';
import { isAbort, WiroToolError } from './wiro';

// Prices, states and errors, worded for the panel.

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1) {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (amount >= 0.01) return `$${trimZeros(amount.toFixed(3))}`;
  return `$${trimZeros(amount.toPrecision(3))}`;
}

function trimZeros(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  // Keep cents readable: 0.2 becomes 0.20.
  return /\.\d$/.test(trimmed) ? `${trimmed}0` : trimmed;
}

/** The price line of search_models, made short for the model list. */
export function shortPricing(model: Pick<ModelSummary, 'pricing' | 'estimatedCostUsd'>): string {
  const text = (model.pricing ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return typeof model.estimatedCostUsd === 'number' ? `about ${formatUsd(model.estimatedCostUsd)}` : '';
  if (/^\$0 \/ per (request|output)/i.test(text)) return 'free';
  if (/^per second of run time|^no fixed price/i.test(text)) return 'by run time';
  if (/^set by the run/i.test(text)) {
    const estimate = /listed estimate \$([0-9.]+)/i.exec(text);
    return estimate ? `about $${estimate[1]}` : 'by usage';
  }
  const estimated = /^~\$([0-9.]+) per run/i.exec(text);
  if (estimated) return `about ${formatUsd(Number(estimated[1]))}`;
  const range = /^\$([0-9.]+(?:e-?\d+)?) to \$[0-9.]+(?:e-?\d+)? \/ per (request|output)/i.exec(text);
  if (range) return `from ${formatUsd(Number(range[1]))} / ${range[2]!.toLowerCase() === 'request' ? 'run' : 'image'}`;
  const pixel = /^\$([0-9.]+(?:e-?\d+)?)(?: to \$[0-9.]+)? per run for an output image/i.exec(text);
  if (pixel) return `from ${formatUsd(Number(pixel[1]))} / image`;
  const fixed = /^\$([0-9.]+(?:e-?\d+)?) \/ per (request|output)/i.exec(text);
  if (fixed) return `${formatUsd(Number(fixed[1]))} / ${fixed[2]!.toLowerCase() === 'request' ? 'run' : 'image'}`;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** The amount a finished task cost, or undefined when Wiro has not said yet. */
export function taskCost(result: TaskResult): number | undefined {
  const charged = result.task.chargedUsd;
  if (typeof charged === 'number' && Number.isFinite(charged)) return charged;
  const cost = result.task.costUsd;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

/**
 * A short word for the task's state. A wait holds the request until the task
 * ends or the wait times out, so "Queued" shows only when Wiro said so.
 */
export function stateLabel(result: TaskResult | undefined): string {
  if (!result) return 'Starting';
  const status = result.task.status ?? '';
  if (result.state === 'completed') return 'Done';
  if (result.state === 'failed') return 'Failed';
  if (result.state === 'cancelled') return 'Cancelled';
  if (result.state === 'running' && /queue|accept/.test(status)) return 'Queued';
  if (/postprocess/.test(status)) return 'Finishing';
  return 'Generating';
}

export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export const BILLING_URL = 'https://wiro.ai/panel/billing';
export const NEW_PROJECT_URL = 'https://wiro.ai/panel/project/new';
export const PROJECTS_URL = 'https://wiro.ai/panel/project';

export interface ErrorView {
  message: string;
  /** A wiro.ai page that helps, with its link text. */
  link?: { url: string; label: string };
  auth?: boolean;
}

/** What to tell the user about an error. */
export function describeError(error: unknown): ErrorView {
  if (isAbort(error)) return { message: 'Stopped.' };
  if (error instanceof AuthError) return { message: error.message, auth: true };
  const message = error instanceof Error ? error.message : String(error);
  if (
    /insufficient|not enough (balance|credit|funds)|add funds|top up|balance is too low|\bcode:? ?97\b/i.test(message)
  ) {
    return { message, link: { url: BILLING_URL, label: 'Add funds' } };
  }
  if (error instanceof WiroToolError || error instanceof McpError) return { message };
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) {
    return { message: 'Wiro AI could not be reached. Check your connection and try again.' };
  }
  if (error instanceof TypeError || error instanceof RangeError) return { message: `Something went wrong: ${message}` };
  return { message };
}

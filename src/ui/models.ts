import { nearestRatio, parseRatio, pixelSizeFor, type Size } from '../shared/geometry';
import type { ModelDetail, ModelParameter, ModelSummary } from './types';

// Image models and their settings, read from each model's Wiro schema.

/** The Wiro category the model list comes from. */
export const IMAGE_CATEGORY = 'text-to-image';

export const DEFAULT_MODEL = 'google/nano-banana-2';

/** Shown first, in this order, when Wiro lists them. */
export const FEATURED_MODELS = [
  'google/nano-banana-pro',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'bytedance/seedream-v4-5',
  'black-forest-labs/flux-2-pro',
  'reve/create-v2',
  'xai/grok-imagine-image',
  'alibaba/qwen-image-3-0-pro',
  'pruna/p-image',
];

/** The value of a ratio setting that follows the shape of the selected layer. */
export const MATCH_SELECTION = '__match_selection__';

// Models the plugin does not list. Figma Community does not allow sexual
// content, so uncensored models stay out. A model that only detects NSFW
// content is a moderation tool and stays in.
const UNCENSORED = /uncensored|decensored|abliterated|obliterated|heretic|refusal[- ]reduced/i;
const NSFW = /nsfw/i;
const MODERATION = /detect|classif|moderat|filter|checker/i;

export function isHiddenModel(model: ModelSummary): boolean {
  if (UNCENSORED.test(`${model.slug} ${model.title} ${model.description ?? ''}`)) return true;
  const name = `${model.slug} ${model.title}`;
  return NSFW.test(name) && !MODERATION.test(name);
}

/** Deduplicated, hidden models removed, featured models first, then Wiro's order. */
export function orderModels(models: readonly ModelSummary[]): ModelSummary[] {
  const seen = new Map<string, ModelSummary>();
  for (const model of models) {
    if (!seen.has(model.slug) && !isHiddenModel(model)) seen.set(model.slug, model);
  }
  const featured = FEATURED_MODELS.map((slug) => seen.get(slug)).filter((model): model is ModelSummary => !!model);
  const rest = [...seen.values()].filter((model) => !FEATURED_MODELS.includes(model.slug));
  return [...featured, ...rest];
}

export function isFeatured(slug: string): boolean {
  return FEATURED_MODELS.includes(slug);
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[-_./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How well a model matches a search: 3 when the slug contains the query as
 * typed ("p-image"), 2 when the title does, 1 when every word appears in the
 * slug or title, 0 otherwise.
 */
export function matchScore(model: ModelSummary, query: string): number {
  const typed = normalize(query);
  if (!typed) return 1;
  if (normalize(model.slug).includes(typed)) return 3;
  if (normalize(model.title).includes(typed)) return 2;
  const haystack = normalize(`${model.slug} ${model.title}`);
  return typed.split(' ').every((word) => haystack.includes(word)) ? 1 : 0;
}

export function matchesQuery(model: ModelSummary, query: string): boolean {
  return matchScore(model, query) > 0;
}

/** The models that match a search, best matches first, otherwise in list order. */
export function searchModels(models: readonly ModelSummary[], query: string): ModelSummary[] {
  return models
    .map((model, index) => ({ model, index, score: matchScore(model, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.model);
}

const FILE_TYPES = new Set(['fileinput', 'multifileinput', 'multifileinputdrop', 'combinefileinput']);
const TEXT_TYPES = new Set(['text', 'textarea', 'string']);
const NUMBER_TYPES = new Set(['number', 'float', 'integer', 'int']);
const CHOICE_TYPES = new Set(['select', 'radio']);
const BOOLEAN_TYPES = new Set(['checkbox', 'boolean', 'toggle', 'switch']);

/** Settings left at the model's own default: safety switches stay as Wiro sets them. */
const LEFT_AT_DEFAULT = /safety|moderation|nsfw/i;

export type FieldKind = 'choice' | 'number' | 'text' | 'textarea' | 'boolean';

export function allParameters(detail: ModelDetail): ModelParameter[] {
  return detail.parameters.flatMap((group) => group.items);
}

export function isFileParameter(param: ModelParameter): boolean {
  return FILE_TYPES.has(param.type.toLowerCase());
}

/** The parameter that takes the prompt. */
export function promptParameter(detail: ModelDetail): ModelParameter | undefined {
  const params = allParameters(detail);
  return (
    params.find((param) => param.id === 'prompt') ??
    params.find(
      (param) => TEXT_TYPES.has(param.type.toLowerCase()) && /prompt/i.test(param.id) && !/negative/i.test(param.id),
    )
  );
}

/** A model that cannot run without an input file, which the plugin does not send. */
export function requiredFile(detail: ModelDetail): ModelParameter | undefined {
  return allParameters(detail).find((param) => param.required && isFileParameter(param));
}

export function fieldKind(param: ModelParameter): FieldKind | undefined {
  const type = param.type.toLowerCase();
  if (param.options.length > 0 && (CHOICE_TYPES.has(type) || TEXT_TYPES.has(type))) return 'choice';
  if (CHOICE_TYPES.has(type)) return param.options.length > 0 ? 'choice' : undefined;
  if (NUMBER_TYPES.has(type)) return 'number';
  if (BOOLEAN_TYPES.has(type)) return 'boolean';
  if (type === 'textarea') return 'textarea';
  if (TEXT_TYPES.has(type)) return 'text';
  return undefined;
}

/** The settings the plugin shows for a model: everything but the prompt, files and safety switches. */
export function settingParameters(detail: ModelDetail): ModelParameter[] {
  const prompt = promptParameter(detail);
  return allParameters(detail).filter(
    (param) =>
      param !== prompt && !isFileParameter(param) && !LEFT_AT_DEFAULT.test(param.id) && fieldKind(param) !== undefined,
  );
}

const PRIMARY =
  /aspect|ratio|resolution|quality|samples|max_?images|num_?images|number_?of|^n$|count|size|width|height/i;

/** Settings shown without opening More settings. */
export function isPrimary(param: ModelParameter): boolean {
  return !param.advanced || PRIMARY.test(param.id);
}

/** A choice of aspect ratios, such as 1:1, 16:9 and 9:16. */
export function isRatioParameter(param: ModelParameter): boolean {
  if (fieldKind(param) !== 'choice') return false;
  if (!/aspect|ratio/i.test(`${param.id} ${param.label}`)) return false;
  return param.options.filter((option) => parseRatio(option.value) !== null).length >= 2;
}

export function ratioValues(param: ModelParameter): string[] {
  return param.options.map((option) => option.value).filter((value) => parseRatio(value) !== null);
}

/** The ratio "Match selection" stands for: the selection's shape, or the model's default ratio. */
export function resolveMatchedRatio(param: ModelParameter, target?: Size): string | undefined {
  const values = ratioValues(param);
  if (target) {
    const nearest = nearestRatio(target.width, target.height, values);
    if (nearest) return nearest;
  }
  if (param.default && parseRatio(param.default) !== null) return param.default;
  if (values.includes('1:1')) return '1:1';
  return values[0];
}

/** The width and height parameters of models that take an exact size. */
export function sizeParameters(detail: ModelDetail): { width: ModelParameter; height: ModelParameter } | undefined {
  const params = allParameters(detail);
  const width = params.find((param) => param.id === 'width' && fieldKind(param) === 'number');
  const height = params.find((param) => param.id === 'height' && fieldKind(param) === 'number');
  return width && height ? { width, height } : undefined;
}

/** Pixel width and height with the selection's shape, within the model's limits. */
export function matchedPixelSize(detail: ModelDetail, target: Size): Size | undefined {
  const size = sizeParameters(detail);
  if (!size) return undefined;
  const longSide = Math.max(Number(size.width.default) || 0, Number(size.height.default) || 0) || 1024;
  const max = Math.min(size.width.max ?? Number.POSITIVE_INFINITY, size.height.max ?? Number.POSITIVE_INFINITY);
  return pixelSizeFor(target.width, target.height, {
    longSide,
    step: size.width.step ?? 16,
    min: Math.max(size.width.min ?? 0, size.height.min ?? 0, 64),
    max: Number.isFinite(max) && max > 0 ? max : undefined,
  });
}

function firstNonEmpty(param: ModelParameter): string | undefined {
  return param.options.find((option) => option.value !== '')?.value;
}

/**
 * The value a setting starts with. Ratios start on "Match selection". Choices
 * with an empty "auto" option, which means "like the input image", start on
 * the first real option for resolutions and sizes, since the plugin sends no
 * input image. Required settings without a default take the sample value Wiro
 * shows on the model page.
 */
export function initialValue(param: ModelParameter): string | undefined {
  if (isRatioParameter(param)) return MATCH_SELECTION;
  const kind = fieldKind(param);
  const fallback = param.default ?? (param.required ? (param.sample ?? param.options[0]?.value) : undefined);
  if (kind === 'choice' && (fallback === undefined || fallback === '') && /resolution|size|quality/i.test(param.id)) {
    return firstNonEmpty(param) ?? fallback;
  }
  return fallback;
}

/** Starting values for every setting of a model. */
export function initialValues(detail: ModelDetail): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of settingParameters(detail)) {
    const value = initialValue(param);
    if (value !== undefined) values[param.id] = value;
  }
  return values;
}

export interface BuildContext {
  prompt: string;
  /** The first selected layer, for "Match selection" and exact sizes. */
  target?: Size;
  /** Settings the user changed by hand. Width and height follow the target otherwise. */
  touched?: ReadonlySet<string>;
}

function convert(param: ModelParameter, value: string): unknown {
  const kind = fieldKind(param);
  if (kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (kind === 'boolean') return value === 'true';
  return value;
}

/**
 * The params of a run_model call. Empty optional settings are left out, so
 * Wiro uses the model's default for them.
 */
export function buildParams(
  detail: ModelDetail,
  values: Readonly<Record<string, string | undefined>>,
  context: BuildContext,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const prompt = promptParameter(detail);
  if (prompt) params[prompt.id] = context.prompt.trim();
  const size = context.target ? matchedPixelSize(detail, context.target) : undefined;
  for (const param of settingParameters(detail)) {
    let value = values[param.id];
    if (value === MATCH_SELECTION) value = resolveMatchedRatio(param, context.target);
    if (size && !context.touched?.has(param.id) && (param.id === 'width' || param.id === 'height')) {
      value = String(param.id === 'width' ? size.width : size.height);
    }
    if (value === undefined) continue;
    if (value === '' && !param.required) continue;
    const converted = convert(param, value);
    if (converted === undefined) continue;
    params[param.id] = converted;
  }
  return params;
}

/** Settings that are required and still empty, by label. */
export function missingRequired(detail: ModelDetail, values: Readonly<Record<string, string | undefined>>): string[] {
  return settingParameters(detail)
    .filter((param) => param.required)
    .filter((param) => {
      const value = values[param.id];
      return value === undefined || value === '';
    })
    .map((param) => param.label || param.id);
}

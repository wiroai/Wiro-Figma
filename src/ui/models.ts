import { nearestRatio, parseRatio, pixelSizeFor, type Size } from '../shared/geometry';
import type { ModelDetail, ModelParameter, ModelSummary } from './types';

// Models and their settings, read from each model's Wiro schema.

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

/** Deduplicated, hidden models removed, featured models first in their order, then Wiro's order. */
export function orderModels(models: readonly ModelSummary[], featured: readonly string[] = []): ModelSummary[] {
  const seen = new Map<string, ModelSummary>();
  for (const model of models) {
    if (!seen.has(model.slug) && !isHiddenModel(model)) seen.set(model.slug, model);
  }
  const first = featured.map((slug) => seen.get(slug)).filter((model): model is ModelSummary => !!model);
  const rest = [...seen.values()].filter((model) => !featured.includes(model.slug));
  return [...first, ...rest];
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

// ---------------------------------------------------------------------------
// Parameters

const FILE_TYPES = new Set(['fileinput', 'multifileinput', 'multifileinputdrop', 'combinefileinput']);
const TEXT_TYPES = new Set(['text', 'textarea', 'string']);
const NUMBER_TYPES = new Set(['number', 'float', 'integer', 'int']);
const CHOICE_TYPES = new Set(['select', 'radio', 'selectwithcover']);
const BOOLEAN_TYPES = new Set(['checkbox', 'boolean', 'toggle', 'switch']);
const JSON_TYPES = new Set(['json', 'json-array']);

/** Settings left at the model's own default: safety switches stay as Wiro sets them. */
const LEFT_AT_DEFAULT = /safety|moderation|nsfw/i;

/** Chat plumbing the plugin never sets: sessions, tool calls and earlier turns. */
const CHAT_PLUMBING = new Set([
  'user_id',
  'session_id',
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'previousTaskToken',
  'toolOutputs',
  'response_format',
]);

export type FieldKind = 'choice' | 'number' | 'text' | 'textarea' | 'boolean' | 'json';

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
    ) ??
    params.find(
      (param) => /^(text|instruction|instructions)$/i.test(param.id) && TEXT_TYPES.has(param.type.toLowerCase()),
    )
  );
}

export function fieldKind(param: ModelParameter): FieldKind | undefined {
  const type = param.type.toLowerCase();
  if (param.options.length > 0 && (CHOICE_TYPES.has(type) || TEXT_TYPES.has(type))) return 'choice';
  if (CHOICE_TYPES.has(type)) return param.options.length > 0 ? 'choice' : undefined;
  if (NUMBER_TYPES.has(type)) return 'number';
  if (BOOLEAN_TYPES.has(type)) return 'boolean';
  if (JSON_TYPES.has(type)) return 'json';
  if (type === 'textarea') return 'textarea';
  if (TEXT_TYPES.has(type)) return 'text';
  return undefined;
}

// ---------------------------------------------------------------------------
// File inputs

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export interface FileSlot {
  param: ModelParameter;
  kind: MediaKind;
  /** single: one URL; list: an array of URLs; multiple: comma-separated URLs in a paired text field. */
  mode: 'single' | 'list' | 'multiple';
  /** For multiple: the text field that takes the URLs. */
  urlParam?: ModelParameter;
}

/**
 * The kind of file a file parameter takes, from its id, label and placeholder.
 * An input that names more than one kind ("images, video or audio", inputAll)
 * takes any file.
 */
export function fileKind(param: ModelParameter): MediaKind {
  const text = `${param.id} ${param.label} ${param.placeholder ?? ''}`.toLowerCase();
  if (/inputall|\ball\b|any file|files/.test(text)) return 'file';
  const kinds: MediaKind[] = [];
  if (/video|clip|mp4|footage/.test(text)) kinds.push('video');
  if (/audio|voice|speech|song|music|sound|mp3|wav|vocal/.test(text)) kinds.push('audio');
  if (
    /image|photo|picture|face|portrait|frame|logo|mask|garment|cloth|human|person|product|reference|selfie|avatar|style/.test(
      text,
    )
  ) {
    kinds.push('image');
  }
  return kinds.length === 1 ? kinds[0]! : 'file';
}

function urlMultipleId(id: string): string {
  return /Multiple$/.test(id) ? id.replace(/Multiple$/, 'UrlMultiple') : `${id}UrlMultiple`;
}

/** The model's file inputs, in schema order, with the URL fields that pair with them. */
export function fileSlots(detail: ModelDetail): FileSlot[] {
  const params = allParameters(detail);
  return params.filter(isFileParameter).map((param) => {
    const type = param.type.toLowerCase();
    const mode: FileSlot['mode'] = type === 'combinefileinput' ? 'list' : type === 'fileinput' ? 'single' : 'multiple';
    const slot: FileSlot = { param, kind: fileKind(param), mode };
    if (mode === 'multiple') {
      slot.urlParam = params.find((candidate) => candidate.id.toLowerCase() === urlMultipleId(param.id).toLowerCase());
    }
    return slot;
  });
}

/** Text fields that only repeat a file field as a URL (inputImage and inputImageUrl): never shown. */
function urlTwins(detail: ModelDetail): Set<string> {
  const params = allParameters(detail);
  const twins = new Set<string>();
  for (const slot of fileSlots(detail)) {
    if (slot.urlParam) twins.add(slot.urlParam.id);
    const twin = params.find((candidate) => candidate.id.toLowerCase() === `${slot.param.id}url`.toLowerCase());
    if (twin) twins.add(twin.id);
  }
  return twins;
}

/**
 * The file slot that takes the image an action sends: the first image input,
 * or a file input of no clear kind. Mask and markup inputs are never used for it.
 */
export function primaryImageSlot(detail: ModelDetail): FileSlot | undefined {
  const slots = fileSlots(detail).filter((slot) => !/mask|markup/i.test(slot.param.id));
  return slots.find((slot) => slot.kind === 'image') ?? slots.find((slot) => slot.kind === 'file');
}

/** A required file input other than the one the action fills, which the plugin cannot provide. */
export function requiredFile(detail: ModelDetail, filled?: FileSlot): ModelParameter | undefined {
  return fileSlots(detail).find((slot) => slot.param.required && slot.param !== filled?.param)?.param;
}

/** How many images a slot takes: lists take several, the rest one. */
export function slotCapacity(slot: FileSlot): number {
  return slot.mode === 'list' ? 16 : 1;
}

/** Where a file input takes its file from: nothing, a selected layer (by position) or a link. */
export type FileChoice = { from: 'none' } | { from: 'layer'; index: number } | { from: 'link'; url: string };

/** Categories whose models work on an image, so their inputs start on the selected layers. */
const IMAGE_INPUT_CATEGORIES = new Set([
  'image-editing',
  'image-to-image',
  'upscale',
  'background-removal',
  'restoration',
  'image-to-text',
  'ocr',
]);

/**
 * The file a model's input starts with in the Models tab. The image inputs of
 * models that work on an image take the selected layers, one per input. Other
 * models get a layer only when the input is required, or, outside text to
 * image, when the layer shows a picture: a frame selected to receive a new
 * image must not go to the model as a reference.
 */
export function defaultFileChoice(
  slot: FileSlot,
  position: number,
  category: string,
  selection: { targets: ReadonlyArray<{ hasImage: boolean }>; skipped: number },
): FileChoice {
  const layers = selection.targets.length + selection.skipped;
  if (!(slot.kind === 'image' || slot.kind === 'file') || /mask|markup/i.test(slot.param.id) || position >= layers) {
    return { from: 'none' };
  }
  const takesLayer =
    IMAGE_INPUT_CATEGORIES.has(category) ||
    slot.param.required ||
    (category !== 'text-to-image' && !!selection.targets[position]?.hasImage);
  return takesLayer ? { from: 'layer', index: position } : { from: 'none' };
}

// ---------------------------------------------------------------------------
// Settings shown in the panel

export interface SettingOptions {
  /** Parameter ids the action sets itself. */
  hidden?: ReadonlySet<string>;
  /** Show file inputs too (the Models tab). */
  files?: boolean;
}

/** The settings the plugin shows for a model: everything but the prompt, safety switches and chat plumbing. */
export function settingParameters(detail: ModelDetail, options: SettingOptions = {}): ModelParameter[] {
  const prompt = promptParameter(detail);
  const twins = urlTwins(detail);
  return allParameters(detail).filter((param) => {
    if (param === prompt || options.hidden?.has(param.id) || twins.has(param.id)) return false;
    if (LEFT_AT_DEFAULT.test(param.id) || CHAT_PLUMBING.has(param.id)) return false;
    if (isFileParameter(param)) return options.files === true;
    return fieldKind(param) !== undefined;
  });
}

const PRIMARY =
  /aspect|ratio|resolution|quality|samples|max_?images|num_?images|number_?of|^n$|count|size|width|height|upscale|scale_?factor|target_?lng|language|outputformat|svg/i;

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
  const fallback = Number(size.width.sample) || 0;
  const longSide = Math.max(Number(size.width.default) || 0, Number(size.height.default) || 0) || fallback || 1024;
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
 * the first real option for resolutions and sizes when no image is sent.
 * Required settings without a default take the sample value Wiro shows on the
 * model page.
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
export function initialValues(detail: ModelDetail, options: SettingOptions = {}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of settingParameters(detail, options)) {
    if (isFileParameter(param)) continue;
    const value = initialValue(param);
    if (value !== undefined) values[param.id] = value;
  }
  return values;
}

/**
 * Settings that make chat models answer fast and plainly for short text jobs:
 * low reasoning and low verbosity, when the model has them and offers the value.
 */
export function quickTextOverrides(detail: ModelDetail): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const param of allParameters(detail)) {
    const values = param.options.map((option) => option.value);
    if (/^(reasoning|reasoning_effort|thinkinglevel)$/i.test(param.id)) {
      const pick = ['low', 'minimal'].find((value) => values.includes(value));
      if (pick) overrides[param.id] = pick;
    }
    if (param.id === 'verbosity' && values.includes('low')) overrides[param.id] = 'low';
    if (param.id === 'webSearch' && values.includes('false')) overrides[param.id] = 'false';
  }
  return overrides;
}

export interface BuildContext {
  prompt: string;
  /** The first selected layer, for "Match selection" and exact sizes. */
  target?: Size;
  /** Settings the user changed by hand. Width and height follow the target otherwise. */
  touched?: ReadonlySet<string>;
  /** Values the action sets itself; they win over the panel's values. */
  fixed?: Readonly<Record<string, string>>;
  /** Files by parameter id: data URIs or URLs. */
  files?: Readonly<Record<string, string[]>>;
}

function convert(param: ModelParameter, value: string): unknown {
  const kind = fieldKind(param);
  if (kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (kind === 'boolean') return value === 'true';
  if (kind === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

/** A JSON setting that does not parse, by label, so the panel can say so before a run. */
export function invalidJson(detail: ModelDetail, values: Readonly<Record<string, string | undefined>>): string[] {
  return allParameters(detail)
    .filter((param) => fieldKind(param) === 'json')
    .filter((param) => {
      const value = values[param.id];
      if (value === undefined || value.trim() === '') return false;
      try {
        JSON.parse(value);
        return false;
      } catch {
        return true;
      }
    })
    .map((param) => param.label || param.id);
}

/**
 * The params of a run_model call. Empty optional settings are left out, so
 * Wiro uses the model's default for them. Files go in the way their input
 * takes them: one URL, an array, or comma-separated URLs in the paired field.
 */
export function buildParams(
  detail: ModelDetail,
  values: Readonly<Record<string, string | undefined>>,
  context: BuildContext,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const prompt = promptParameter(detail);
  if (prompt && context.prompt.trim()) params[prompt.id] = context.prompt.trim();
  const size = context.target ? matchedPixelSize(detail, context.target) : undefined;
  const merged: Record<string, string | undefined> = { ...values, ...(context.fixed ?? {}) };
  for (const param of allParameters(detail)) {
    if (param === prompt || isFileParameter(param) || LEFT_AT_DEFAULT.test(param.id)) continue;
    if (CHAT_PLUMBING.has(param.id) && !(context.fixed && param.id in context.fixed)) continue;
    let value = merged[param.id];
    if (value === MATCH_SELECTION) value = resolveMatchedRatio(param, context.target);
    const fixed = context.fixed && param.id in context.fixed;
    if (size && !fixed && !context.touched?.has(param.id) && (param.id === 'width' || param.id === 'height')) {
      value = String(param.id === 'width' ? size.width : size.height);
    }
    if (value === undefined) continue;
    if (value === '' && !param.required) continue;
    const converted = convert(param, value);
    if (converted === undefined) continue;
    params[param.id] = converted;
  }
  for (const slot of fileSlots(detail)) {
    const files = context.files?.[slot.param.id]?.filter(Boolean) ?? [];
    if (files.length === 0) continue;
    if (slot.mode === 'list') params[slot.param.id] = files.slice(0, slotCapacity(slot));
    else if (slot.mode === 'single') params[slot.param.id] = files[0];
    else if (slot.urlParam) params[slot.urlParam.id] = files.join(',');
  }
  return params;
}

/** Settings that are required and still empty, by label. File inputs count when nothing fills them. */
export function missingRequired(
  detail: ModelDetail,
  values: Readonly<Record<string, string | undefined>>,
  options: {
    fixed?: Readonly<Record<string, string>>;
    files?: Readonly<Record<string, string[]>>;
    hidden?: ReadonlySet<string>;
  } = {},
): string[] {
  const missing: string[] = [];
  const prompt = promptParameter(detail);
  for (const param of allParameters(detail)) {
    if (!param.required || param === prompt) continue;
    if (CHAT_PLUMBING.has(param.id) || LEFT_AT_DEFAULT.test(param.id)) continue;
    if (isFileParameter(param)) {
      if (!(options.files?.[param.id]?.length ?? 0)) missing.push(param.label || param.id);
      continue;
    }
    if (options.fixed && param.id in options.fixed) continue;
    const value = values[param.id];
    if (value === undefined || value === '') missing.push(param.label || param.id);
  }
  return missing;
}

/** The parameter that sets how many images a run makes, if the model has one. */
export function countParameter(detail: ModelDetail): ModelParameter | undefined {
  return allParameters(detail).find(
    (param) =>
      fieldKind(param) === 'number' &&
      /^(samples|maximages|max_images|numimages|num_images|numberofimages|number_of_images|n|count|num_outputs)$/i.test(
        param.id,
      ),
  );
}

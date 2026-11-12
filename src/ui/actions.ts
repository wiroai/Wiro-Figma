// The plugin's actions. Each one names the Wiro categories its models come
// from, what it reads from the selection, what it puts back and how the
// prompt is written. Models are listed live from Wiro; the defaults below are
// models that were checked for each action.

export type ActionId =
  | 'generate'
  | 'svg'
  | 'edit'
  | 'variations'
  | 'style'
  | 'upscale'
  | 'remove-background'
  | 'mockup'
  | 'rewrite'
  | 'shorten'
  | 'translate';

export type TabId = 'create' | 'edit' | 'text' | 'models' | 'history';

export interface Preset {
  id: string;
  label: string;
  /** Text added to the prompt for this preset. */
  text: string;
}

export interface Action {
  id: ActionId;
  tab: 'create' | 'edit' | 'text';
  label: string;
  /** One line under the action's name. */
  hint: string;
  categories: string[];
  /** What the action reads from the selection. */
  input: 'none' | 'image' | 'text';
  output: 'image' | 'svg' | 'text';
  prompt: 'required' | 'optional' | 'hidden';
  promptLabel?: string;
  promptHint?: string;
  defaultModel: string;
  featured: string[];
  /** Settings the action sets itself, by parameter id. */
  fixed?: Record<string, string>;
  /** Settings that do not apply to this action, left at the model's default. */
  hide?: string[];
  /** Only these models are listed, when set. */
  only?: string[];
  presets?: { label: string; items: Preset[] };
  /** How results are placed by default. */
  placement?: 'fill' | 'replace' | 'beside';
}

const IMAGE_MODELS = [
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

const EDIT_MODELS = [
  'google/nano-banana-pro',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'bytedance/seedream-v4-5',
  'black-forest-labs/flux-2-pro',
  'alibaba/qwen-image-3-0-pro',
  'reve/remix-v2',
  'xai/grok-imagine-image',
];

const TEXT_MODELS = [
  'openai/gpt-5-4-nano',
  'openai/gpt-5-4-mini',
  'google/gemini-3-5-flash-lite',
  'google/gemini-3-5-flash',
  'claude/sonnet-5',
  'deepseek/v4-1-flash',
];

export const STYLES: Preset[] = [
  { id: 'watercolor', label: 'Watercolor', text: 'a soft watercolor painting with visible paper texture' },
  {
    id: 'flat',
    label: 'Flat illustration',
    text: 'a clean flat vector illustration with simple shapes and a limited palette',
  },
  { id: '3d', label: '3D render', text: 'a polished 3D render with soft studio lighting' },
  { id: 'line-art', label: 'Line art', text: 'black and white line art with clean, even strokes' },
  { id: 'pixel', label: 'Pixel art', text: 'retro pixel art' },
  { id: 'oil', label: 'Oil painting', text: 'an oil painting with rich brush strokes' },
  { id: 'sketch', label: 'Pencil sketch', text: 'a pencil sketch with light shading' },
  { id: 'clay', label: 'Clay', text: 'a handmade clay figure scene' },
  { id: 'isometric', label: 'Isometric', text: 'an isometric illustration' },
  { id: 'risograph', label: 'Risograph', text: 'a risograph print with grainy two-color ink' },
];

export const PRODUCTS: Preset[] = [
  { id: 't-shirt', label: 'T-shirt', text: 'printed on the front of a plain t-shirt worn by a person' },
  { id: 'mug', label: 'Mug', text: 'printed on a white ceramic mug on a table' },
  { id: 'phone', label: 'Phone screen', text: 'shown on the screen of a modern smartphone held in a hand' },
  { id: 'laptop', label: 'Laptop screen', text: 'shown on the screen of an open laptop on a desk' },
  { id: 'poster', label: 'Poster', text: 'printed as a framed poster on a wall' },
  { id: 'tote', label: 'Tote bag', text: 'printed on a canvas tote bag' },
  { id: 'box', label: 'Packaging', text: 'printed on a product packaging box' },
  { id: 'billboard', label: 'Billboard', text: 'shown on a large billboard by a city street' },
  { id: 'card', label: 'Business card', text: 'printed on a business card lying on a desk' },
  { id: 'cap', label: 'Cap', text: 'embroidered on the front of a baseball cap' },
];

export const TONES: Preset[] = [
  { id: 'clearer', label: 'Clearer', text: 'Make it clearer and easier to read.' },
  { id: 'friendlier', label: 'Friendlier', text: 'Make it warmer and friendlier.' },
  { id: 'formal', label: 'More formal', text: 'Make it more formal and professional.' },
  { id: 'persuasive', label: 'More persuasive', text: 'Make it more persuasive.' },
  { id: 'simpler', label: 'Simpler', text: 'Use simpler words and shorter sentences.' },
  { id: 'fix', label: 'Fix grammar', text: 'Fix spelling and grammar only. Change nothing else.' },
];

export const LENGTHS: Preset[] = [
  { id: 'shorter', label: 'A bit shorter', text: 'Make it about a quarter shorter.' },
  { id: 'half', label: 'Half as long', text: 'Make it about half as long.' },
  { id: 'line', label: 'One line', text: 'Make it fit on one short line.' },
  { id: 'words', label: 'A few words', text: 'Make it at most five words.' },
];

export const LANGUAGES: Preset[] = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Polish',
  'Turkish',
  'Russian',
  'Ukrainian',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Indonesian',
  'Vietnamese',
  'Thai',
  'Japanese',
  'Korean',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Swedish',
  'Danish',
  'Norwegian',
  'Finnish',
  'Greek',
  'Czech',
  'Romanian',
  'Hungarian',
].map((name) => ({ id: name.toLowerCase().replace(/[^a-z]+/g, '-'), label: name, text: name }));

export const ACTIONS: Action[] = [
  {
    id: 'generate',
    tab: 'create',
    label: 'Image',
    hint: 'Generate an image from a prompt and fill the selected layers with it.',
    categories: ['text-to-image'],
    input: 'none',
    output: 'image',
    prompt: 'required',
    promptHint: 'Describe the image, for example: a ceramic coffee cup on a linen table, soft morning light',
    defaultModel: 'google/nano-banana-2',
    featured: IMAGE_MODELS,
    placement: 'fill',
  },
  {
    id: 'svg',
    tab: 'create',
    label: 'Vector',
    hint: 'Draw an icon or illustration as editable vector layers (SVG).',
    categories: ['text-to-image'],
    input: 'none',
    output: 'svg',
    prompt: 'required',
    promptHint: 'Describe the icon or illustration, for example: a minimal line icon of a paper plane',
    defaultModel: 'openai/gpt-image-2-6-flare-custom',
    featured: ['openai/gpt-image-2-6-flare-custom', 'openai/gpt-image-2-6-sunburst-custom'],
    only: ['openai/gpt-image-2-6-flare-custom', 'openai/gpt-image-2-6-sunburst-custom'],
    // SVG output always makes one image; the GIF settings do not apply.
    fixed: { outputFormat: 'svg', samples: '1' },
    hide: ['frameCount', 'frameDurationMs', 'outputCompression'],
  },
  {
    id: 'edit',
    tab: 'edit',
    label: 'Edit',
    hint: 'Change the selected image with a prompt.',
    categories: ['image-editing'],
    input: 'image',
    output: 'image',
    prompt: 'required',
    promptLabel: 'What should change?',
    promptHint: 'For example: put the bottle on a wet black stone, keep the label as it is',
    defaultModel: 'google/nano-banana-2',
    featured: EDIT_MODELS,
    placement: 'replace',
  },
  {
    id: 'variations',
    tab: 'edit',
    label: 'Variations',
    hint: 'Make new versions of the selected image, placed beside it.',
    categories: ['image-editing'],
    input: 'image',
    output: 'image',
    prompt: 'optional',
    promptLabel: 'Anything to keep or change?',
    promptHint: 'Optional, for example: keep the colors, try other angles',
    defaultModel: 'google/nano-banana-2',
    featured: EDIT_MODELS,
    placement: 'beside',
  },
  {
    id: 'style',
    tab: 'edit',
    label: 'Style',
    hint: 'Redraw the selected image in another style. Select a second layer to use its style.',
    categories: ['image-editing'],
    input: 'image',
    output: 'image',
    prompt: 'optional',
    promptLabel: 'Extra direction',
    promptHint: 'Optional, for example: pastel colors',
    defaultModel: 'google/nano-banana-2',
    featured: EDIT_MODELS,
    presets: { label: 'Style', items: STYLES },
    placement: 'beside',
  },
  {
    id: 'upscale',
    tab: 'edit',
    label: 'Upscale',
    hint: 'Make the selected image larger and sharper.',
    categories: ['upscale'],
    input: 'image',
    output: 'image',
    prompt: 'hidden',
    defaultModel: 'xinntao/real-esrgan',
    featured: ['xinntao/real-esrgan', 'wiro/image-restoration', 'wiroai/flux-upscaler', 'google/upscaler'],
    placement: 'replace',
  },
  {
    id: 'remove-background',
    tab: 'edit',
    label: 'Remove background',
    hint: 'Cut out the subject of the selected image on a transparent background.',
    categories: ['background-removal'],
    input: 'image',
    output: 'image',
    prompt: 'hidden',
    defaultModel: 'briaai/rmbg-2-0',
    featured: ['briaai/rmbg-2-0', 'wiro/remove-background', 'ideogram/remove-background', 'zhengpeng7/birefnet'],
    placement: 'replace',
  },
  {
    id: 'mockup',
    tab: 'edit',
    label: 'Mockup',
    hint: 'Put the selected design or logo on a product photo, placed beside it.',
    categories: ['image-editing'],
    input: 'image',
    output: 'image',
    prompt: 'optional',
    promptLabel: 'Extra direction',
    promptHint: 'Optional, for example: on a wooden table, morning light',
    defaultModel: 'google/nano-banana-2',
    featured: EDIT_MODELS,
    presets: { label: 'Product', items: PRODUCTS },
    placement: 'beside',
  },
  {
    id: 'rewrite',
    tab: 'text',
    label: 'Rewrite',
    hint: 'Rewrite the selected text layers in the same language.',
    categories: ['partner-llm'],
    input: 'text',
    output: 'text',
    prompt: 'optional',
    promptLabel: 'Your own instruction',
    promptHint: 'Optional, for example: sound like a friendly travel app',
    defaultModel: 'openai/gpt-5-4-nano',
    featured: TEXT_MODELS,
    presets: { label: 'Tone', items: TONES },
  },
  {
    id: 'shorten',
    tab: 'text',
    label: 'Shorten',
    hint: 'Make the selected text layers shorter and keep the message.',
    categories: ['partner-llm'],
    input: 'text',
    output: 'text',
    prompt: 'hidden',
    defaultModel: 'openai/gpt-5-4-nano',
    featured: TEXT_MODELS,
    presets: { label: 'Length', items: LENGTHS },
  },
  {
    id: 'translate',
    tab: 'text',
    label: 'Translate',
    hint: 'Translate the selected text layers.',
    // LLMs only: they read the source language themselves. Translation models
    // that ask for it are in the Models tab.
    categories: ['partner-llm'],
    input: 'text',
    output: 'text',
    prompt: 'hidden',
    defaultModel: 'openai/gpt-5-4-nano',
    featured: TEXT_MODELS,
    presets: { label: 'Into', items: LANGUAGES },
  },
];

export function actionById(id: ActionId): Action {
  return ACTIONS.find((action) => action.id === id)!;
}

export function actionsFor(tab: Action['tab']): Action[] {
  return ACTIONS.filter((action) => action.tab === tab);
}

/** The prompt an image action sends, from what the user typed and the chosen preset. */
export function imagePrompt(
  action: Action,
  typed: string,
  preset: Preset | undefined,
  hasStyleReference: boolean,
): string {
  const extra = typed.trim();
  switch (action.id) {
    case 'variations':
      return [
        'Create a new variation of this image. Keep the subject and the overall style, and change the composition and details.',
        extra,
      ]
        .filter(Boolean)
        .join(' ');
    case 'style':
      if (hasStyleReference) {
        return ['Redraw the first image in the style of the second image. Keep the content of the first image.', extra]
          .filter(Boolean)
          .join(' ');
      }
      return [`Redraw this image as ${preset?.text ?? STYLES[0]!.text}. Keep the subject and the composition.`, extra]
        .filter(Boolean)
        .join(' ');
    case 'mockup':
      return [
        `Create a realistic product photo of this design ${preset?.text ?? PRODUCTS[0]!.text}. Keep the design exactly as it is, sharp and not distorted.`,
        extra,
      ]
        .filter(Boolean)
        .join(' ');
    default:
      return extra;
  }
}

/** The name of new layers an image action adds, from the source layer and the choice made. */
export function resultName(action: Action, source: string, preset: Preset | undefined, typed: string): string {
  switch (action.id) {
    case 'variations':
      return `${source} variation`;
    case 'style':
      return `${source}, ${preset?.label ?? 'restyled'}`;
    case 'mockup':
      return `${preset?.label ?? 'Product'} mockup`;
    case 'upscale':
      return `${source} upscaled`;
    case 'remove-background':
      return `${source} cutout`;
    default:
      return typed.trim() || `${source} edit`;
  }
}

/** The instruction a text action sends to an LLM, with the layer's text at the end. */
export function textPrompt(action: Action, text: string, preset: Preset | undefined, typed: string): string {
  const rules =
    'Return only the new text, with no quotes, labels or explanations. Keep line breaks, numbers, emoji and placeholders such as {name} as they are.';
  switch (action.id) {
    case 'translate':
      return `Translate the text below into ${preset?.text ?? 'English'}. Keep the tone. ${rules}\n\nText:\n${text}`;
    case 'shorten':
      return `${preset?.text ?? LENGTHS[0]!.text} Keep the key message and the language of the text. ${rules}\n\nText:\n${text}`;
    default: {
      const instruction = [preset?.text, typed.trim()].filter(Boolean).join(' ') || 'Improve the wording.';
      return `Rewrite the text below. ${instruction} Keep the meaning and the language of the text. ${rules}\n\nText:\n${text}`;
    }
  }
}

/** An LLM's answer without wrapping quotes or code fences. */
export function cleanAnswer(text: string): string {
  let answer = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(answer);
  if (fence) answer = fence[1]!.trim();
  const quoted = /^["“'](.*)["”']$/s.exec(answer);
  if (quoted && !/["“”]/.test(quoted[1]!)) answer = quoted[1]!.trim();
  return answer;
}

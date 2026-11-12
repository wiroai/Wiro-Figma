import { describe, expect, it } from 'vitest';
import { actionById } from '../../src/ui/actions';
import {
  buildParams,
  countParameter,
  defaultFileChoice,
  fieldKind,
  fileKind,
  fileSlots,
  initialValues,
  invalidJson,
  isHiddenModel,
  isPrimary,
  isRatioParameter,
  MATCH_SELECTION,
  matchedPixelSize,
  matchesQuery,
  matchScore,
  missingRequired,
  orderModels,
  primaryImageSlot,
  promptParameter,
  quickTextOverrides,
  requiredFile,
  resolveMatchedRatio,
  searchModels,
  settingParameters,
} from '../../src/ui/models';
import type { ModelDetail, ModelParameter, ModelSummary } from '../../src/ui/types';
import fluxPro from '../fixtures/black-forest-labs_flux-2-pro.json';
import rmbg from '../fixtures/briaai_rmbg-2-0.json';
import seedream from '../fixtures/bytedance_seedream-v4-5.json';
import gemini from '../fixtures/google_gemini-3-flash.json';
import nanoBananaPro from '../fixtures/google_nano-banana-pro.json';
import gpt5nano from '../fixtures/openai_gpt-5-nano.json';
import gptImage2 from '../fixtures/openai_gpt-image-2.json';
import flareCustom from '../fixtures/openai_gpt-image-2-6-flare-custom.json';
import pImage from '../fixtures/pruna_p-image.json';
import fluxDev from '../fixtures/wiro_flux-2-dev.json';
import esrgan from '../fixtures/xinntao_real-esrgan.json';
import catalog from '../fixtures/text-to-image-models.json';

// The fixtures are the public schemas of these models, as get_model_schema
// returned them on 2026-11-11.
const models = {
  fluxPro: fluxPro as ModelDetail,
  seedream: seedream as ModelDetail,
  nanoBananaPro: nanoBananaPro as ModelDetail,
  gptImage2: gptImage2 as ModelDetail,
  pImage: pImage as ModelDetail,
  fluxDev: fluxDev as ModelDetail,
  rmbg: rmbg as ModelDetail,
  gemini: gemini as ModelDetail,
  gpt5nano: gpt5nano as ModelDetail,
  flareCustom: flareCustom as ModelDetail,
  esrgan: esrgan as ModelDetail,
};

const ids = (params: ModelParameter[]) => params.map((param) => param.id);
const landscape = { width: 1920, height: 1080 };
const portrait = { width: 1080, height: 1350 };
const param = (fields: Partial<ModelParameter>): ModelParameter => ({
  id: 'x',
  type: 'text',
  label: '',
  required: false,
  options: [],
  advanced: false,
  ...fields,
});

describe('the model list', () => {
  const list = catalog as ModelSummary[];
  const featured = actionById('generate').featured;

  it('leaves out uncensored and NSFW models', () => {
    const ordered = orderModels(list, featured);
    expect(ordered.some((model) => /uncensored/i.test(model.slug))).toBe(false);
    expect(list.some((model) => /uncensored/i.test(model.slug))).toBe(true);
    expect(isHiddenModel({ slug: 'a/nsfw-detector', title: 'NSFW Detector', categories: [] })).toBe(false);
    expect(isHiddenModel({ slug: 'a/nsfw-art', title: 'NSFW Art', categories: [] })).toBe(true);
    expect(isHiddenModel({ slug: 'a/b', title: 'B', description: 'An abliterated model', categories: [] })).toBe(true);
  });

  it('puts an action’s featured models first, in their order, then keeps Wiro order', () => {
    const ordered = orderModels(list, featured);
    const present = featured.filter((slug) => list.some((model) => model.slug === slug));
    expect(ordered.slice(0, present.length).map((model) => model.slug)).toEqual(present);
    const rest = ordered.slice(present.length).map((model) => model.slug);
    const expected = list
      .map((model) => model.slug)
      .filter((slug) => !featured.includes(slug) && !/uncensored/i.test(slug));
    expect(rest).toEqual([...new Set(expected)]);
    expect(orderModels(list).map((model) => model.slug)[0]).toBe('google/nano-banana-pro');
  });

  it('puts models whose slug contains the query first', () => {
    const ordered = orderModels([...list, { slug: 'pruna/p-image', title: 'P-Image', categories: [] }], featured);
    expect(searchModels(ordered, 'p-image')[0]!.slug).toBe('pruna/p-image');
    expect(matchScore({ slug: 'pruna/p-image', title: 'P-Image', categories: [] }, 'P Image')).toBe(3);
    expect(matchScore({ slug: 'a/b', title: 'Seedream 4.5', categories: [] }, 'seedream 4')).toBe(2);
    expect(matchScore({ slug: 'openai/gpt-image-2', title: 'GPT Image', categories: [] }, 'image openai')).toBe(1);
    expect(matchesQuery({ slug: 'google/nano-banana-pro', title: 'Nano Banana Pro', categories: [] }, 'flux')).toBe(
      false,
    );
  });
});

describe('settings from a schema', () => {
  it('finds the prompt and leaves out files, safety switches and chat plumbing', () => {
    expect(promptParameter(models.gptImage2)?.id).toBe('prompt');
    expect(ids(settingParameters(models.nanoBananaPro))).toEqual(['aspectRatio', 'resolution']);
    expect(ids(settingParameters(models.pImage))).toEqual(['aspectRatio', 'seed']);
    expect(ids(settingParameters(models.gpt5nano))).toEqual([
      'systemInstructions',
      'reasoning',
      'webSearch',
      'verbosity',
      'max_output_tokens',
    ]);
    expect(ids(settingParameters(models.rmbg, { files: true }))).toEqual(['inputImage']);
  });

  it('hides the settings an action sets itself', () => {
    expect(ids(settingParameters(models.flareCustom, { hidden: new Set(['outputFormat']) }))).not.toContain(
      'outputFormat',
    );
  });

  it('shows the shape, size, quality, count and format settings up front', () => {
    expect(ids(settingParameters(models.gptImage2).filter(isPrimary))).toEqual([
      'resolution',
      'ratio',
      'quality',
      'outputFormat',
      'samples',
    ]);
    expect(ids(settingParameters(models.esrgan).filter(isPrimary))).toEqual(['modelName', 'outscale', 'faceEnhance']);
  });

  it('knows each field kind', () => {
    expect(fieldKind(param({ type: 'selectwithcover', options: [{ label: 'English', value: 'English' }] }))).toBe(
      'choice',
    );
    expect(fieldKind(param({ type: 'json' }))).toBe('json');
    expect(fieldKind(param({ type: 'checkbox' }))).toBe('boolean');
    expect(fieldKind(param({ type: 'float' }))).toBe('number');
    expect(fieldKind(param({ type: 'mystery' }))).toBeUndefined();
  });

  it('recognises ratio choices', () => {
    const [aspect, resolution] = settingParameters(models.nanoBananaPro);
    expect(isRatioParameter(aspect!)).toBe(true);
    expect(isRatioParameter(resolution!)).toBe(false);
  });
});

describe('file inputs', () => {
  it('reads the slots of a model and which one takes the image', () => {
    expect(fileSlots(models.gptImage2).map((slot) => [slot.param.id, slot.kind, slot.mode])).toEqual([
      ['inputImage', 'image', 'list'],
      ['inputImageMask', 'image', 'list'],
    ]);
    expect(primaryImageSlot(models.gptImage2)?.param.id).toBe('inputImage');
    expect(primaryImageSlot(models.gemini)?.param.id).toBe('inputAll');
    expect(primaryImageSlot(models.pImage)).toBeUndefined();
  });

  it('treats inputs that name several kinds as any file', () => {
    expect(fileKind(param({ id: 'inputAll', label: 'input files' }))).toBe('file');
    expect(fileKind(param({ id: 'media', label: 'Image, video or audio' }))).toBe('file');
    expect(fileKind(param({ id: 'inputVideo', label: 'Video' }))).toBe('video');
    expect(fileKind(param({ id: 'inputImage', label: 'Input Image' }))).toBe('image');
  });

  it('says when a model needs a file the action does not fill', () => {
    const slot = primaryImageSlot(models.rmbg)!;
    expect(requiredFile(models.rmbg, slot)).toBeUndefined();
    expect(requiredFile(models.rmbg)?.id).toBe('inputImage');
  });

  it('starts file inputs on the selection only where the model works on an image', () => {
    const [reference] = fileSlots(models.nanoBananaPro);
    const frame = { targets: [{ hasImage: false }], skipped: 0 };
    const photo = { targets: [{ hasImage: true }], skipped: 0 };
    // A layer selected to receive a text-to-image result is not a reference, even with a picture in it.
    expect(defaultFileChoice(reference!, 0, 'text-to-image', frame)).toEqual({ from: 'none' });
    expect(defaultFileChoice(reference!, 0, 'text-to-image', photo)).toEqual({ from: 'none' });
    expect(defaultFileChoice(reference!, 0, 'image-editing', frame)).toEqual({ from: 'layer', index: 0 });
    expect(defaultFileChoice(reference!, 0, 'image-editing', { targets: [], skipped: 0 })).toEqual({ from: 'none' });
    const needed = { ...reference!, param: { ...reference!.param, required: true } };
    expect(defaultFileChoice(needed, 0, 'text-to-image', frame)).toEqual({ from: 'layer', index: 0 });
    const [files] = fileSlots(models.gemini);
    expect(defaultFileChoice(files!, 0, 'partner-llm', photo)).toEqual({ from: 'layer', index: 0 });
    expect(defaultFileChoice(files!, 0, 'partner-llm', frame)).toEqual({ from: 'none' });
    const [, mask] = fileSlots(models.gptImage2);
    const two = { targets: [{ hasImage: true }, { hasImage: true }], skipped: 0 };
    expect(defaultFileChoice(mask!, 1, 'image-editing', two)).toEqual({ from: 'none' });
  });

  it('sends files the way each input takes them', () => {
    const uri = 'data:image/png;base64,AAAA';
    expect(buildParams(models.rmbg, {}, { prompt: '', files: { inputImage: [uri] } })).toEqual({ inputImage: [uri] });
    const single: ModelDetail = {
      ...models.pImage,
      parameters: [
        {
          title: '',
          items: [param({ id: 'image', type: 'fileinput', label: 'Image' }), param({ id: 'prompt', type: 'textarea' })],
        },
      ],
    };
    expect(buildParams(single, {}, { prompt: 'p', files: { image: [uri, 'https://x/y.png'] } })).toEqual({
      prompt: 'p',
      image: uri,
    });
    const multiple: ModelDetail = {
      ...models.pImage,
      parameters: [
        {
          title: '',
          items: [
            param({ id: 'inputDocumentMultiple', type: 'multifileinput', label: 'Documents' }),
            param({ id: 'inputDocumentUrlMultiple', type: 'text', label: 'URLs' }),
          ],
        },
      ],
    };
    expect(
      buildParams(multiple, {}, { prompt: '', files: { inputDocumentMultiple: ['https://a', 'https://b'] } }),
    ).toEqual({ inputDocumentUrlMultiple: 'https://a,https://b' });
    expect(ids(settingParameters(multiple))).toEqual([]);
  });
});

describe('initial values', () => {
  it('fills required settings with Wiro sample values when there is no default', () => {
    expect(initialValues(models.gptImage2)).toEqual({
      resolution: '1k',
      ratio: MATCH_SELECTION,
      quality: 'low',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: '100',
      samples: '1',
    });
    expect(initialValues(models.esrgan)).toMatchObject({
      modelName: 'RealESRGAN_x4plus',
      outscale: '2.0',
      faceEnhance: 'true',
    });
  });

  it('starts resolution on a real option instead of "auto"', () => {
    expect(initialValues(models.seedream)).toEqual({
      resolution: '2k',
      aspectRatio: MATCH_SELECTION,
      maxImages: '1',
      watermark: 'false',
    });
  });

  it('has nothing missing at the start, except files no one filled', () => {
    for (const model of [models.gptImage2, models.seedream, models.nanoBananaPro, models.pImage, models.fluxPro]) {
      expect(missingRequired(model, initialValues(model))).toEqual([]);
    }
    expect(missingRequired(models.gptImage2, { ...initialValues(models.gptImage2), quality: '' })).toEqual(['Quality']);
    expect(missingRequired(models.rmbg, {})).toEqual(['Input Image']);
    expect(missingRequired(models.rmbg, {}, { files: { inputImage: ['x'] } })).toEqual([]);
    expect(
      missingRequired(
        models.gptImage2,
        {},
        { fixed: { resolution: '1k', ratio: '1:1', quality: 'low', samples: '1' } },
      ),
    ).toEqual([]);
  });
});

describe('Match selection and sizes', () => {
  it('picks the ratio nearest to the selected layer', () => {
    const ratio = settingParameters(models.gptImage2)[1]!;
    expect(resolveMatchedRatio(ratio, landscape)).toBe('16:9');
    expect(resolveMatchedRatio(ratio, portrait)).toBe('3:4');
    expect(resolveMatchedRatio(settingParameters(models.pImage)[0]!)).toBe('16:9');
    expect(resolveMatchedRatio(settingParameters(models.nanoBananaPro)[0]!)).toBe('1:1');
  });

  it('sizes exact-size models to the selection, within their limits', () => {
    expect(matchedPixelSize(models.fluxPro, landscape)).toEqual({ width: 1024, height: 576 });
    expect(matchedPixelSize(models.fluxPro, portrait)).toEqual({ width: 816, height: 1024 });
    expect(matchedPixelSize(models.gptImage2, landscape)).toBeUndefined();
  });
});

describe('buildParams', () => {
  it('builds a GPT Image 2 run for a 16:9 frame', () => {
    expect(
      buildParams(models.gptImage2, initialValues(models.gptImage2), {
        prompt: '  A ceramic cup  ',
        target: landscape,
      }),
    ).toEqual({
      prompt: 'A ceramic cup',
      resolution: '1k',
      ratio: '16:9',
      quality: 'low',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 100,
      samples: 1,
    });
  });

  it('lets fixed values win and keeps them from the target size', () => {
    const values = initialValues(models.flareCustom, { hidden: new Set(['outputFormat']) });
    const params = buildParams(models.flareCustom, values, {
      prompt: 'icon',
      target: landscape,
      fixed: { outputFormat: 'svg', width: '1024', height: '1024' },
    });
    expect(params).toMatchObject({ prompt: 'icon', outputFormat: 'svg', width: 1024, height: 1024, quality: 'low' });
  });

  it('leaves out empty optional settings and never sends safety switches or plumbing', () => {
    expect(buildParams(models.pImage, { aspectRatio: '1:1', seed: '' }, { prompt: 'p' })).toEqual({
      prompt: 'p',
      aspectRatio: '1:1',
    });
    expect(
      buildParams(models.pImage, { aspectRatio: '1:1', disableSafetyChecker: 'true' }, { prompt: 'p' }),
    ).not.toHaveProperty('disableSafetyChecker');
    expect(buildParams(models.gpt5nano, { session_id: 'x', reasoning: 'low' }, { prompt: 'Hi' })).toEqual({
      prompt: 'Hi',
      reasoning: 'low',
    });
  });

  it('matches width and height to the selection unless the user set them', () => {
    const values = initialValues(models.fluxPro);
    expect(buildParams(models.fluxPro, values, { prompt: 'p', target: landscape })).toMatchObject({
      width: 1024,
      height: 576,
    });
    expect(
      buildParams(
        models.fluxPro,
        { ...values, width: '640', height: '640' },
        { prompt: 'p', target: landscape, touched: new Set(['width', 'height']) },
      ),
    ).toMatchObject({ width: 640, height: 640 });
  });

  it('parses JSON settings and reports the ones that do not parse', () => {
    const detail: ModelDetail = {
      ...models.pImage,
      parameters: [
        {
          title: '',
          items: [param({ id: 'prompt', type: 'textarea' }), param({ id: 'extra', type: 'json', label: 'Extra' })],
        },
      ],
    };
    expect(buildParams(detail, { extra: '{"a":1}' }, { prompt: 'p' })).toEqual({ prompt: 'p', extra: { a: 1 } });
    expect(buildParams(detail, { extra: '{nope' }, { prompt: 'p' })).toEqual({ prompt: 'p' });
    expect(invalidJson(detail, { extra: '{nope' })).toEqual(['Extra']);
    expect(invalidJson(detail, { extra: ' ' })).toEqual([]);
  });
});

describe('text and count helpers', () => {
  it('asks chat models to answer fast and plainly', () => {
    expect(quickTextOverrides(models.gpt5nano)).toEqual({ reasoning: 'low', webSearch: 'false', verbosity: 'low' });
    expect(quickTextOverrides(models.gemini)).toEqual({ thinkingLevel: 'low' });
    expect(quickTextOverrides(models.pImage)).toEqual({});
  });

  it('finds the setting for how many images a run makes', () => {
    expect(countParameter(models.gptImage2)?.id).toBe('samples');
    expect(countParameter(models.seedream)?.id).toBe('maxImages');
    expect(countParameter(models.nanoBananaPro)).toBeUndefined();
  });
});

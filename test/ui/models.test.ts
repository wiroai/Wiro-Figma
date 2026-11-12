import { describe, expect, it } from 'vitest';
import {
  buildParams,
  FEATURED_MODELS,
  initialValues,
  isHiddenModel,
  isPrimary,
  isRatioParameter,
  MATCH_SELECTION,
  matchedPixelSize,
  matchesQuery,
  matchScore,
  missingRequired,
  orderModels,
  promptParameter,
  requiredFile,
  resolveMatchedRatio,
  searchModels,
  settingParameters,
} from '../../src/ui/models';
import type { ModelDetail, ModelParameter, ModelSummary } from '../../src/ui/types';
import fluxPro from '../fixtures/black-forest-labs_flux-2-pro.json';
import seedream from '../fixtures/bytedance_seedream-v4-5.json';
import nanoBananaPro from '../fixtures/google_nano-banana-pro.json';
import gptImage2 from '../fixtures/openai_gpt-image-2.json';
import pImage from '../fixtures/pruna_p-image.json';
import fluxDev from '../fixtures/wiro_flux-2-dev.json';
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
};

const ids = (params: ModelParameter[]) => params.map((param) => param.id);
const landscape = { width: 1920, height: 1080 };
const portrait = { width: 1080, height: 1350 };

describe('the model list', () => {
  const list = catalog as ModelSummary[];

  it('leaves out uncensored and NSFW models', () => {
    const ordered = orderModels(list);
    expect(ordered.some((model) => /uncensored/i.test(model.slug))).toBe(false);
    expect(list.some((model) => /uncensored/i.test(model.slug))).toBe(true);
    expect(isHiddenModel({ slug: 'a/nsfw-detector', title: 'NSFW Detector', categories: [] })).toBe(false);
    expect(isHiddenModel({ slug: 'a/nsfw-art', title: 'NSFW Art', categories: [] })).toBe(true);
    expect(isHiddenModel({ slug: 'a/b', title: 'B', description: 'An abliterated model', categories: [] })).toBe(true);
  });

  it('puts the featured models first, in their order, then keeps Wiro order', () => {
    const ordered = orderModels(list);
    const featuredInList = FEATURED_MODELS.filter((slug) => list.some((model) => model.slug === slug));
    expect(ordered.slice(0, featuredInList.length).map((model) => model.slug)).toEqual(featuredInList);
    const rest = ordered.slice(featuredInList.length).map((model) => model.slug);
    const expected = list
      .map((model) => model.slug)
      .filter((slug) => !FEATURED_MODELS.includes(slug) && !/uncensored/i.test(slug));
    expect(rest).toEqual([...new Set(expected)]);
  });

  it('removes duplicates', () => {
    const one = list[2]!;
    expect(orderModels([one, one]).filter((model) => model.slug === one.slug)).toHaveLength(1);
  });

  it('puts models whose slug contains the query first', () => {
    const pImageRow = { slug: 'pruna/p-image', title: 'P-Image', categories: ['text-to-image'] };
    const ordered = orderModels([...list, pImageRow]);
    const found = searchModels(ordered, 'p-image');
    expect(found[0]!.slug).toBe('pruna/p-image');
    // Other models with "image" in the slug still match, after it.
    expect(found.length).toBeGreaterThan(1);
    expect(matchScore({ slug: 'pruna/p-image', title: 'P-Image', categories: [] }, 'P Image')).toBe(3);
    expect(matchScore({ slug: 'a/b', title: 'Seedream 4.5', categories: [] }, 'seedream 4')).toBe(2);
    expect(matchScore({ slug: 'openai/gpt-image-2', title: 'GPT Image', categories: [] }, 'image openai')).toBe(1);
    expect(searchModels(ordered, '').length).toBe(ordered.length);
  });

  it('finds models by any word of the slug or title', () => {
    const banana = { slug: 'google/nano-banana-pro', title: 'Nano Banana Pro API', categories: [] };
    expect(matchesQuery(banana, 'banana pro')).toBe(true);
    expect(matchesQuery(banana, 'GOOGLE nano')).toBe(true);
    expect(matchesQuery(banana, 'nano-banana')).toBe(true);
    expect(matchesQuery(banana, 'flux')).toBe(false);
  });
});

describe('settings from a schema', () => {
  it('finds the prompt and leaves out files, the prompt and safety switches', () => {
    expect(promptParameter(models.gptImage2)?.id).toBe('prompt');
    expect(ids(settingParameters(models.gptImage2))).toEqual([
      'resolution',
      'ratio',
      'quality',
      'background',
      'outputFormat',
      'outputCompression',
      'samples',
    ]);
    expect(ids(settingParameters(models.nanoBananaPro))).toEqual(['aspectRatio', 'resolution']);
    expect(ids(settingParameters(models.pImage))).toEqual(['aspectRatio', 'seed']);
    expect(ids(settingParameters(models.fluxPro))).toEqual(['width', 'height', 'seed', 'outputFormat']);
  });

  it('shows the shape, size, quality and count settings up front', () => {
    const primary = settingParameters(models.gptImage2).filter(isPrimary);
    expect(ids(primary)).toEqual(['resolution', 'ratio', 'quality', 'samples']);
    expect(ids(settingParameters(models.seedream).filter(isPrimary))).toEqual([
      'resolution',
      'aspectRatio',
      'maxImages',
    ]);
  });

  it('recognises ratio choices', () => {
    const [aspect] = settingParameters(models.nanoBananaPro);
    expect(isRatioParameter(aspect!)).toBe(true);
    const resolution = settingParameters(models.nanoBananaPro)[1]!;
    expect(isRatioParameter(resolution)).toBe(false);
  });

  it('sees that none of these models needs an input file', () => {
    for (const model of Object.values(models)) expect(requiredFile(model)).toBeUndefined();
    const editOnly: ModelDetail = {
      ...models.pImage,
      parameters: [
        {
          title: '',
          items: [
            { id: 'inputImage', type: 'fileinput', label: 'Image', required: true, options: [], advanced: false },
            ...models.pImage.parameters[0]!.items,
          ],
        },
      ],
    };
    expect(requiredFile(editOnly)?.id).toBe('inputImage');
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
  });

  it('starts resolution on a real option instead of "auto", since no input image is sent', () => {
    expect(initialValues(models.seedream)).toEqual({
      resolution: '2k',
      aspectRatio: MATCH_SELECTION,
      maxImages: '1',
      watermark: 'false',
    });
  });

  it('keeps model defaults', () => {
    expect(initialValues(models.nanoBananaPro)).toEqual({ aspectRatio: MATCH_SELECTION, resolution: '1K' });
    expect(initialValues(models.fluxDev)).toMatchObject({ steps: '15', samples: '1', width: '1024', height: '1024' });
  });

  it('has nothing missing at the start', () => {
    for (const model of Object.values(models)) expect(missingRequired(model, initialValues(model))).toEqual([]);
    expect(missingRequired(models.gptImage2, { ...initialValues(models.gptImage2), quality: '' })).toEqual(['Quality']);
  });
});

describe('Match selection', () => {
  it('picks the ratio nearest to the selected layer', () => {
    const ratio = settingParameters(models.gptImage2)[1]!;
    expect(resolveMatchedRatio(ratio, landscape)).toBe('16:9');
    expect(resolveMatchedRatio(ratio, portrait)).toBe('3:4');
  });

  it('falls back to the model default, then 1:1, without a selection', () => {
    const pImageRatio = settingParameters(models.pImage)[0]!;
    expect(resolveMatchedRatio(pImageRatio)).toBe('16:9');
    const nanoRatio = settingParameters(models.nanoBananaPro)[0]!;
    expect(resolveMatchedRatio(nanoRatio)).toBe('1:1');
  });

  it('sizes exact-size models to the selection, within their limits', () => {
    expect(matchedPixelSize(models.fluxPro, landscape)).toEqual({ width: 1024, height: 576 });
    expect(matchedPixelSize(models.fluxPro, portrait)).toEqual({ width: 816, height: 1024 });
    expect(matchedPixelSize(models.gptImage2, landscape)).toBeUndefined();
  });
});

describe('buildParams', () => {
  it('builds a GPT Image 2 run for a 16:9 frame', () => {
    const params = buildParams(models.gptImage2, initialValues(models.gptImage2), {
      prompt: '  A ceramic cup  ',
      target: landscape,
    });
    expect(params).toEqual({
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

  it('builds a Seedream run with its required settings and no selection', () => {
    expect(buildParams(models.seedream, initialValues(models.seedream), { prompt: 'p' })).toEqual({
      prompt: 'p',
      resolution: '2k',
      aspectRatio: '1:1',
      maxImages: 1,
      watermark: 'false',
    });
  });

  it('leaves out empty optional settings so Wiro uses its defaults', () => {
    const params = buildParams(models.pImage, { aspectRatio: '1:1', seed: '' }, { prompt: 'p' });
    expect(params).toEqual({ prompt: 'p', aspectRatio: '1:1' });
  });

  it('sends a ratio the user chose instead of the matched one', () => {
    const params = buildParams(
      models.nanoBananaPro,
      { aspectRatio: '9:16', resolution: '2K' },
      {
        prompt: 'p',
        target: landscape,
      },
    );
    expect(params).toEqual({ prompt: 'p', aspectRatio: '9:16', resolution: '2K' });
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
        { ...values, width: '640' },
        { prompt: 'p', target: landscape, touched: new Set(['width']) },
      ),
    ).toMatchObject({ width: 640, height: 576 });
    expect(buildParams(models.fluxPro, values, { prompt: 'p' })).toMatchObject({ width: 1024, height: 1024 });
  });

  it('never sends safety switches, file fields or numbers that are not numbers', () => {
    const params = buildParams(
      models.pImage,
      { aspectRatio: '1:1', seed: 'abc', disableSafetyChecker: 'true' },
      {
        prompt: 'p',
      },
    );
    expect(params).toEqual({ prompt: 'p', aspectRatio: '1:1', seed: 'abc' });
    const flux = buildParams(models.fluxDev, { ...initialValues(models.fluxDev), steps: 'many' }, { prompt: 'p' });
    expect(flux).not.toHaveProperty('steps');
    expect(flux).not.toHaveProperty('inputImage');
  });
});

import { describe, expect, it } from 'vitest';
import { actionById, cleanAnswer, textPrompt, TONES } from '../../src/ui/actions';
import { readSize, sniffFormat, toBase64 } from '../../src/ui/images';
import { McpClient } from '../../src/ui/mcp';
import {
  buildParams,
  initialValues,
  orderModels,
  primaryImageSlot,
  quickTextOverrides,
  requiredFile,
  settingParameters,
} from '../../src/ui/models';
import { parsePriceTable, quote } from '../../src/ui/pricing';
import { readAnswer, recentFrom } from '../../src/ui/results';
import { WiroApi } from '../../src/ui/wiro';

// Runs the plugin's logic against the live Wiro AI API. It runs only through
// `npm run test:live` with WIRO_API_KEY set, and each run costs about $0.02.
// Projects with signature authentication also set WIRO_API_SECRET.

const apiKey = process.env.WIRO_API_KEY;
const apiSecret = process.env.WIRO_API_SECRET;
const live = apiKey && process.env.WIRO_LIVE_TEST === '1' ? describe : describe.skip;

const api = new WiroApi(new McpClient(() => (apiKey ? { apiKey, ...(apiSecret ? { apiSecret } : {}) } : null)));

/** Downloads a result the way the plugin iframe does (Origin: null) and checks the CDN's CORS answer. */
async function download(url: string) {
  const response = await fetch(url, { headers: { Origin: 'null' } });
  expect(response.ok).toBe(true);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, format: sniffFormat(bytes), size: readSize(bytes) };
}

async function generate(slug: string, target: { width: number; height: number } | undefined, prompt: string) {
  const { model: detail, text } = await api.getModel(slug);
  expect(requiredFile(detail)).toBeUndefined();
  const params = buildParams(detail, initialValues(detail), { prompt, target });
  const states: string[] = [];
  const result = await api.runToEnd(slug, params, { onUpdate: (update) => states.push(update.state) });
  expect(result.state).toBe('completed');
  const images = recentFrom(result, slug, prompt);
  expect(images.length).toBeGreaterThan(0);
  return { detail, text, params, result, states, ...(await download(images[0]!.url)) };
}

/** A 1 x 1 red PNG, so the test needs no image library. */
function redSquarePng(): Uint8Array {
  return Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'),
    (char) => char.charCodeAt(0),
  );
}

live('live Wiro AI API', () => {
  it('lists the image models', async () => {
    const page = await api.searchModels({ categories: ['text-to-image'], sort: 'ratedusercount', limit: 100 });
    const models = orderModels(page.models, actionById('generate').featured);
    expect(models.length).toBeGreaterThan(20);
    expect(models.some((model) => /uncensored/i.test(model.slug))).toBe(false);
    expect(models[0]!.slug).toBe('google/nano-banana-pro');
  });

  it('reads the account without charging anything', async () => {
    const account = await api.getAccount();
    expect(typeof account.balance?.totalUsd).toBe('number');
  });

  it('generates a 16:9 image for a 1920 x 1080 frame with P-Image', { timeout: 180_000 }, async () => {
    const run = await generate(
      'pruna/p-image',
      { width: 1920, height: 1080 },
      'A paper boat on a calm lake, soft light',
    );
    expect(run.params).toMatchObject({ aspectRatio: '16:9' });
    expect(['png', 'jpeg']).toContain(run.format);
    expect(run.size!.width / run.size!.height).toBeCloseTo(16 / 9, 1);
    expect(run.states.at(-1)).toBe('completed');
  });

  it(
    'fills GPT Image 2 required settings, matches a portrait frame and quotes the price',
    { timeout: 240_000 },
    async () => {
      const run = await generate('openai/gpt-image-2', { width: 1080, height: 1350 }, 'A ceramic cup, studio light');
      expect(run.params).toMatchObject({ resolution: '1k', ratio: '3:4', quality: 'low', samples: 1 });
      expect(settingParameters(run.detail).map((param) => param.id)).not.toContain('moderation');
      expect(run.size!.height).toBeGreaterThan(run.size!.width);
      const table = parsePriceTable(run.text);
      const priced = quote({ table, params: run.params, outputs: 1, runs: 1 });
      expect(priced.amount).toBe(run.result.task.costUsd);
    },
  );

  it('removes the background of an image sent as a data URI', { timeout: 180_000 }, async () => {
    const { model: detail } = await api.getModel('briaai/rmbg-2-0');
    const slot = primaryImageSlot(detail)!;
    const uri = `data:image/png;base64,${toBase64(redSquarePng())}`;
    const params = buildParams(detail, initialValues(detail), { prompt: '', files: { [slot.param.id]: [uri] } });
    const result = await api.runToEnd('briaai/rmbg-2-0', params);
    expect(result.state).toBe('completed');
    const [image] = recentFrom(result, 'briaai/rmbg-2-0', '');
    expect((await download(image!.url)).format).toBe('png');
  });

  it('rewrites a text with a chat model', { timeout: 120_000 }, async () => {
    const { model: detail } = await api.getModel('openai/gpt-5-4-nano');
    const prompt = textPrompt(actionById('rewrite'), 'Plan your next trip in minutes', TONES[1], '');
    const params = buildParams(detail, initialValues(detail), { prompt, fixed: quickTextOverrides(detail) });
    const result = await api.runToEnd('openai/gpt-5-4-nano', params);
    expect(result.state).toBe('completed');
    const answer = cleanAnswer((await readAnswer(result)) ?? '');
    expect(answer.length).toBeGreaterThan(5);
    expect(answer).not.toMatch(/^Text:/);
  });
});

import { describe, expect, it } from 'vitest';
import { readSize, sniffFormat } from '../../src/ui/images';
import { McpClient } from '../../src/ui/mcp';
import { buildParams, initialValues, orderModels, requiredFile, settingParameters } from '../../src/ui/models';
import { recentFrom } from '../../src/ui/results';
import { WiroApi } from '../../src/ui/wiro';

// Runs the plugin's generation logic against the live Wiro AI API. It runs
// only through `npm run test:live` with WIRO_API_KEY set, and each run costs
// about $0.01. Projects with signature authentication also set WIRO_API_SECRET.

const apiKey = process.env.WIRO_API_KEY;
const apiSecret = process.env.WIRO_API_SECRET;
const live = apiKey && process.env.WIRO_LIVE_TEST === '1' ? describe : describe.skip;

const api = new WiroApi(new McpClient(() => (apiKey ? { apiKey, ...(apiSecret ? { apiSecret } : {}) } : null)));

async function generate(slug: string, target: { width: number; height: number } | undefined, prompt: string) {
  const detail = await api.getModel(slug);
  expect(requiredFile(detail)).toBeUndefined();
  const params = buildParams(detail, initialValues(detail), { prompt, target });
  const states: string[] = [];
  const result = await api.runToEnd(slug, params, { onUpdate: (update) => states.push(update.state) });
  expect(result.state).toBe('completed');
  const images = recentFrom(result, slug, prompt);
  expect(images.length).toBeGreaterThan(0);
  // The plugin iframe sends Origin: null, so check the CDN's CORS answer to that.
  const response = await fetch(images[0]!.url, { headers: { Origin: 'null' } });
  expect(response.ok).toBe(true);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { detail, params, result, states, bytes, format: sniffFormat(bytes), size: readSize(bytes) };
}

live('live Wiro AI API', () => {
  it('lists the image models', async () => {
    const page = await api.searchModels({ categories: ['text-to-image'], sort: 'ratedusercount', limit: 100 });
    const models = orderModels(page.models);
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
    console.log(`p-image: ${run.size!.width}x${run.size!.height} ${run.format}, $${run.result.task.chargedUsd}`);
  });

  it('fills GPT Image 2 required settings and matches a portrait frame', { timeout: 240_000 }, async () => {
    const run = await generate('openai/gpt-image-2', { width: 1080, height: 1350 }, 'A ceramic cup, studio light');
    expect(run.params).toMatchObject({ resolution: '1k', ratio: '3:4', quality: 'low', samples: 1 });
    expect(settingParameters(run.detail).map((param) => param.id)).not.toContain('moderation');
    expect(run.size!.height).toBeGreaterThan(run.size!.width);
    console.log(`gpt-image-2: ${run.size!.width}x${run.size!.height} ${run.format}, $${run.result.task.chargedUsd}`);
  });
});

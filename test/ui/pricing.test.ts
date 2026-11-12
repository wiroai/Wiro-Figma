import { describe, expect, it } from 'vitest';
import { parsePriceTable, quote, tablePrice } from '../../src/ui/pricing';
import gptImage2 from '../fixtures/pricing-gpt-image-2.md?raw';
import nanoBanana2 from '../fixtures/pricing-nano-banana-2.md?raw';
import pImage from '../fixtures/pricing-p-image.md?raw';

// The price texts are what get_model_schema returned on 2026-11-11.
const texts: Record<string, string> = {
  'pricing-gpt-image-2.md': gptImage2,
  'pricing-nano-banana-2.md': nanoBanana2,
  'pricing-p-image.md': pImage,
};
const fixture = (name: string) => texts[name]!;

describe('parsePriceTable', () => {
  it('reads a one-column table', () => {
    const table = parsePriceTable(fixture('pricing-nano-banana-2.md'))!;
    expect(table.unit).toBe('output');
    expect(table.columns).toEqual(['resolution']);
    expect(table.rows.map((row) => [row.values[0], row.price])).toEqual([
      ['512', 0.045],
      ['1K', 0.067],
      ['2K', 0.101],
      ['4K', 0.151],
    ]);
  });

  it('reads a table that depends on several settings', () => {
    const table = parsePriceTable(fixture('pricing-gpt-image-2.md'))!;
    expect(table.unit).toBe('request');
    expect(table.columns).toEqual(['quality', 'resolution', 'ratio']);
    expect(tablePrice(table, { quality: 'low', resolution: '1k', ratio: '16:9' })).toBe(0.003);
    expect(tablePrice(table, { quality: 'high', resolution: '1k', ratio: '1:1' })).toBe(0.211);
    expect(tablePrice(table, { quality: 'ultra', resolution: '1k', ratio: '1:1' })).toBeUndefined();
  });

  it('finds no table when the price is one line', () => {
    expect(parsePriceTable(fixture('pricing-p-image.md'))).toBeUndefined();
    expect(parsePriceTable('No pricing here')).toBeUndefined();
  });
});

describe('quote', () => {
  const nano = parsePriceTable(fixture('pricing-nano-banana-2.md'))!;

  it('multiplies per-output prices by the images and the runs', () => {
    expect(quote({ table: nano, params: { resolution: '1K' }, outputs: 1, runs: 1 })).toEqual({
      amount: 0.067,
      line: '$0.067 for this run',
    });
    expect(quote({ table: nano, params: { resolution: '4K' }, outputs: 2, runs: 3 }).line).toBe(
      '$0.906 for this run (3 runs)',
    );
  });

  it('falls back to the catalog summary', () => {
    expect(quote({ params: {}, outputs: 1, runs: 1, summary: { pricing: '$0.005 / per request' } }).line).toBe(
      '$0.005 / run',
    );
    expect(
      quote({
        table: nano,
        params: { resolution: '8K' },
        outputs: 1,
        runs: 1,
        summary: { pricing: '$0.045 to $0.151 / per output' },
      }).line,
    ).toBe('From $0.045 / image');
    expect(
      quote({ params: {}, outputs: 1, runs: 2, summary: { pricing: 'Set by the run when it ends: tokens.' } }).line,
    ).toBe('Billed by usage when the run ends (2 runs)');
    expect(
      quote({
        params: {},
        outputs: 1,
        runs: 1,
        summary: { pricing: '~$0.02 per run (estimated)', estimatedCostUsd: 0.02 },
      }).line,
    ).toBe('About $0.02');
  });
});

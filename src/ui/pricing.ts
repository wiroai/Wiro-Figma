import { formatUsd, shortPricing } from './format';
import type { ModelSummary } from './types';

// The price shown before a run. get_model_schema returns, beside the schema, a
// Markdown text with the model's price table when the price depends on its
// settings:
//
//   ### Pricing (per output)
//   | resolution | Price |
//   | --- | --- |
//   | 1K | $0.067 |
//
// The row whose settings match the run gives the price; "per output" prices
// are multiplied by the number of images the run asks for.

export interface PriceTable {
  /** "output", "request" and so on, from the heading. */
  unit: string;
  columns: string[];
  rows: Array<{ values: string[]; price: number }>;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parsePrice(text: string): number | undefined {
  const match = /\$\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)/i.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** The first price table in a schema text, or undefined when there is none. */
export function parsePriceTable(text: string): PriceTable | undefined {
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => /^#{2,4}\s*Pricing\b/i.test(line.trim()));
  if (heading === -1) return undefined;
  const unit = /\(per ([^)]+)\)/i.exec(lines[heading]!)?.[1]?.trim().toLowerCase() ?? 'request';
  let at = heading + 1;
  while (at < lines.length && !lines[at]!.trim().startsWith('|')) {
    if (/^#{2,4}\s/.test(lines[at]!.trim())) return undefined;
    at += 1;
  }
  const header = lines[at] ? cells(lines[at]!) : [];
  if (header.length < 2 || !/price/i.test(header[header.length - 1]!)) return undefined;
  const rows: PriceTable['rows'] = [];
  for (at += 2; at < lines.length && lines[at]!.trim().startsWith('|'); at += 1) {
    const row = cells(lines[at]!);
    const price = parsePrice(row[row.length - 1] ?? '');
    if (price === undefined || row.length !== header.length) continue;
    rows.push({ values: row.slice(0, -1), price });
  }
  if (rows.length === 0) return undefined;
  return { unit, columns: header.slice(0, -1), rows };
}

const WILDCARD = /^(any|all|\*|-|–)$/i;

function same(a: unknown, b: string): boolean {
  if (WILDCARD.test(b)) return true;
  return (
    String(a ?? '')
      .trim()
      .toLowerCase() === b.trim().toLowerCase()
  );
}

/** The table's price for these params, for one output or one request. */
export function tablePrice(table: PriceTable, params: Readonly<Record<string, unknown>>): number | undefined {
  const row = table.rows.find((candidate) =>
    table.columns.every((column, index) => same(params[column], candidate.values[index] ?? '')),
  );
  return row?.price;
}

export interface Quote {
  /** The price of the whole run when it is known up front. */
  amount?: number;
  /** One line for the panel. */
  line: string;
}

/**
 * The price line for a run: the exact amount when the price table covers the
 * settings, otherwise the model's price summary from the catalog.
 */
export function quote(options: {
  table?: PriceTable;
  params: Readonly<Record<string, unknown>>;
  outputs: number;
  runs: number;
  summary?: Pick<ModelSummary, 'pricing' | 'estimatedCostUsd'>;
}): Quote {
  const { table, params, runs } = options;
  const times = runs > 1 ? ` (${runs} runs)` : '';
  if (table) {
    const unitPrice = tablePrice(table, params);
    if (unitPrice !== undefined) {
      const perOutput = /output|image/.test(table.unit);
      const amount = unitPrice * (perOutput ? Math.max(1, options.outputs) : 1) * Math.max(1, runs);
      return { amount, line: `${formatUsd(amount)} for this run${times}` };
    }
  }
  const text = (options.summary?.pricing ?? '').trim();
  if (/^set by the run|per .*token|turn by turn/i.test(text)) {
    const estimate = options.summary?.estimatedCostUsd;
    return {
      line:
        typeof estimate === 'number'
          ? `About ${formatUsd(estimate * Math.max(1, runs))}${times}, billed by usage`
          : `Billed by usage when the run ends${times}`,
    };
  }
  const short = options.summary ? shortPricing(options.summary) : '';
  return {
    line: short ? `${short.charAt(0).toUpperCase()}${short.slice(1)}${times}` : `Price on the model page${times}`,
  };
}

import path from "path";
import type { Provider } from "./agents/defaults";
import { readJson, writeJsonAtomic } from "./fsutil";

// Model prices in USD per 1M tokens, used to estimate each step's cost. Defaults come from
// the providers' official pricing pages (checked 2026-11-06, standard tier, short context);
// edits from the Prompts page are saved to agents/pricing.json and override them.
//   OpenAI: https://developers.openai.com/api/docs/pricing
//   Gemini: https://aistudio.google.com/docs/pricing
//   Claude: Anthropic model pricing

export const PRICES_AS_OF = "2026-11-06";

export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // Claude
  "claude-fable-5-1": { input: 10, cachedInput: 0.25, output: 50 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-sonnet-5-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  // OpenAI
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
  "gpt-6.1-terra": { input: 1, cachedInput: 0.05, output: 5 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  // Gemini (rates in effect through Nov/Dec 2026; several rise on 2026-12-01 / 2027-01-01)
  "gemini-4-argon": { input: 2, cachedInput: 0.1, output: 10 },
  "gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, cachedInput: 0.025, output: 1.5 },
  "gemini-3.1-pro-preview": { input: 2, cachedInput: 0.2, output: 12 },
  "gemini-3-flash-preview": { input: 0.5, cachedInput: 0.05, output: 3 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gemini-2.5-flash": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cachedInput: 0.01, output: 0.4 },
};

/** USD per web search call / grounded request (free monthly allowances not subtracted). */
export const DEFAULT_SEARCH_PRICE: Record<Provider, number> = { anthropic: 0.01, openai: 0.01, gemini: 0.014 };

const FILE = path.join(process.cwd(), "agents", "pricing.json");
type FileShape = { models?: Record<string, ModelPrice> };

function overrides(): Record<string, ModelPrice> {
  return readJson<FileShape>(FILE)?.models ?? {};
}

export function allPrices(): { model: string; price: ModelPrice; source: "official" | "custom" }[] {
  const custom = overrides();
  const keys = [...new Set([...Object.keys(DEFAULT_PRICES), ...Object.keys(custom)])].sort();
  return keys.map((model) => ({ model, price: custom[model] ?? DEFAULT_PRICES[model], source: custom[model] ? "custom" : "official" }));
}

/** Price for a model id: exact match, else the longest known id it starts with (dated snapshots). */
export function priceFor(model: string): { price: ModelPrice; source: "official" | "custom"; matched: string } | null {
  const custom = overrides();
  const table = { ...DEFAULT_PRICES, ...custom };
  let key = table[model] ? model : "";
  if (!key) key = Object.keys(table).filter((k) => model.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0] ?? "";
  if (!key) return null;
  return { price: table[key], source: custom[key] ? "custom" : "official", matched: key };
}

export function savePrice(model: string, price: ModelPrice | null) {
  if (!/^[\w.\-:/]{1,100}$/.test(model)) throw new Error("Enter a valid model name.");
  const file = readJson<FileShape>(FILE) ?? {};
  const models = { ...(file.models ?? {}) };
  if (price === null) delete models[model];
  else {
    for (const v of [price.input, price.cachedInput, price.output])
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10000) throw new Error("Prices must be numbers between 0 and 10000.");
    models[model] = { input: price.input, cachedInput: price.cachedInput, output: price.output };
  }
  writeJsonAtomic(FILE, { ...file, models });
}

/**
 * Estimated cost in USD, or null when the model has no price.
 * inputTokens excludes cache reads; cacheWriteTokens (Claude only) bill at 1.25x input.
 */
export function estimateCost(o: {
  provider: Provider;
  model: string;
  inputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens: number;
  outputTokens: number;
  webSearches: number;
}): number | null {
  const hit = priceFor(o.model);
  if (!hit) return null;
  const p = hit.price;
  const tokens = o.inputTokens * p.input + (o.cacheWriteTokens ?? 0) * p.input * 1.25 + o.cacheReadTokens * p.cachedInput + o.outputTokens * p.output;
  return tokens / 1e6 + o.webSearches * DEFAULT_SEARCH_PRICE[o.provider];
}

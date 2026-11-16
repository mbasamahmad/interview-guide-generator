import type { z } from "zod";
import type { Provider } from "../agents/defaults";
import { PROVIDERS } from "../agents/defaults";
import { anthropicAdapter, describeAnthropicError } from "./anthropic";
import { describeOpenAIError, openaiAdapter } from "./openai";
import { describeGeminiError, geminiAdapter } from "./gemini";
import { AgentError, addUsage, fillPrompt, type ModelCfg, type ProviderAdapter, type WebSource } from "./common";
import type { Usage } from "../store";
import { readGlobalConfig, readProviderDefaults } from "../providerDefaults";

export { AgentError, addUsage, emptyUsage, fillPrompt } from "./common";
export type { ModelCfg, WebSource } from "./common";

const ADAPTERS: Record<Provider, ProviderAdapter> = { anthropic: anthropicAdapter, openai: openaiAdapter, gemini: geminiAdapter };

/** Which providers have a key configured (never returns the keys themselves). */
export function providerStatus(): Record<Provider, boolean> {
  return {
    anthropic: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE),
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}

export function listModels(provider: Provider): Promise<string[]> {
  return ADAPTERS[provider].listModels();
}

// Preference order when an agent's own provider has no key.
const FALLBACK_ORDER: Provider[] = ["anthropic", "openai", "gemini"];
const AUTO_TTL_MS = 60 * 60 * 1000;
const g = globalThis as unknown as { __autoDefaults?: Map<Provider, { model: string | null; at: number }> };
const autoDefaults = (g.__autoDefaults ??= new Map());

/** Default model for a provider: the one set in agents/providers.json, else picked from its model list. */
export async function providerDefaultModel(provider: Provider): Promise<{ model: string | null; source: "configured" | "auto" }> {
  const configured = readProviderDefaults()[provider];
  if (configured) return { model: configured, source: "configured" };
  const hit = autoDefaults.get(provider);
  if (hit && Date.now() - hit.at < AUTO_TTL_MS) return { model: hit.model, source: "auto" };
  let model: string | null = null;
  try {
    model = await ADAPTERS[provider].defaultModel();
  } catch {
    model = null;
  }
  if (!model && provider === "anthropic") model = "claude-opus-5-5";
  autoDefaults.set(provider, { model, at: Date.now() });
  return { model, source: "auto" };
}

export function clearAutoDefaults() {
  autoDefaults.clear();
}

/**
 * The provider and model an agent actually runs on. If its provider has no API key and
 * another provider does, it falls back to that provider's default model. The agent's
 * saved settings are not changed.
 */
export async function resolveModelCfg<T extends ModelCfg>(cfg: T): Promise<T & { fallbackFrom?: Provider; global?: boolean }> {
  const keys = providerStatus();
  // Global "one model for all agents" wins when its provider has a key.
  const global = readGlobalConfig();
  if (global.mode === "all" && global.provider && keys[global.provider]) {
    const model = global.model || (await providerDefaultModel(global.provider)).model;
    if (model) return { ...cfg, provider: global.provider, model, effort: global.effort || cfg.effort, global: true };
  }
  if (keys[cfg.provider]) return cfg;
  for (const p of FALLBACK_ORDER) {
    if (p === cfg.provider || !keys[p]) continue;
    const { model } = await providerDefaultModel(p);
    if (model) return { ...cfg, provider: p, model, fallbackFrom: cfg.provider };
  }
  return cfg; // no usable key anywhere: the call reports the missing key
}

/** One call on the agent's provider; returns JSON validated against `schema`. */
export async function structured<S extends z.ZodType>(opts: {
  cfg: ModelCfg;
  system: string[];
  user: string;
  schema: S;
  label: string;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const { text, usage } = await ADAPTERS[opts.cfg.provider].structuredText(opts);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AgentError(`${opts.label}: response was not valid JSON.`);
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new AgentError(`${opts.label}: response did not match the expected structure: ${parsed.error.message.slice(0, 400)}`);
  return { data: parsed.data, usage };
}

/**
 * Research: phase 1 searches the web and writes notes with the provider's own search
 * tool; phase 2 converts the notes to `schema` on the same provider without tools.
 */
export async function research<S extends z.ZodType>(opts: {
  cfg: ModelCfg & { prompt: string };
  task: string;
  schema: S;
  label: string;
  maxSearches?: number;
}): Promise<{ data: z.infer<S>; notes: string; webSources: WebSource[]; usage: Usage }> {
  const web = await ADAPTERS[opts.cfg.provider].webResearch({
    cfg: opts.cfg,
    system: fillPrompt(opts.cfg.prompt),
    task: opts.task,
    label: opts.label,
    maxSearches: opts.maxSearches ?? 15,
  });
  if (!web.notes.trim()) throw new AgentError(`${opts.label}: research produced no notes.`);

  const extracted = await structured({
    cfg: { ...opts.cfg, effort: "low" },
    label: `${opts.label} (structuring)`,
    schema: opts.schema,
    system: [
      `Convert research notes into the required JSON structure. Use only information present in the notes or the source list. Keep every URL exactly as written. Keep each finding's confidence label (verified / reported / inferred) exactly as the notes give it; if the notes do not say, use "inferred". Use "unknown" for missing dates or facts rather than guessing. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    ],
    user: `<task>\n${opts.task}\n</task>\n\n<research_notes>\n${web.notes}\n</research_notes>\n\n<sources_seen>\n${web.sources
      .map((s) => `- ${s.title} | ${s.url} | page age: ${s.pageAge}`)
      .join("\n")}\n</sources_seen>`,
  });
  return { data: extracted.data, notes: web.notes, webSources: web.sources, usage: addUsage(web.usage, extracted.usage) };
}

export function describeError(err: unknown): string {
  const specific = describeAnthropicError(err) ?? describeOpenAIError(err) ?? describeGeminiError(err);
  if (specific) return specific;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const providerLabel = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.label ?? p;

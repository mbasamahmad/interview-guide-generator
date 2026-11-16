import fs from "fs";
import path from "path";
import type { z } from "zod";
import type { Effort, Provider } from "../agents/defaults";
import type { Usage } from "../store";

export interface ModelCfg {
  provider: Provider;
  model: string;
  effort: Effort;
}

export interface WebSource {
  url: string;
  title: string;
  pageAge: string;
}

export interface StructuredOpts<S extends z.ZodType> {
  cfg: ModelCfg;
  /** System prompt blocks. Stable content first so providers can cache the prefix. */
  system: string[];
  user: string;
  schema: S;
  label: string;
  maxTokens?: number;
}

export interface WebResearchOpts {
  cfg: ModelCfg;
  system: string;
  task: string;
  label: string;
  maxSearches: number;
}

/** What each provider adapter implements. */
export interface ProviderAdapter {
  /** One call that returns JSON text matching the schema. */
  structuredText(opts: StructuredOpts<z.ZodType>): Promise<{ text: string; usage: Usage }>;
  /** A web-enabled call that returns research notes and the sources it saw. */
  webResearch(opts: WebResearchOpts): Promise<{ notes: string; sources: WebSource[]; usage: Usage }>;
  listModels(): Promise<string[]>;
  /** The model to use when an agent falls back to this provider: newest full-size general model. */
  defaultModel(): Promise<string | null>;
}

export class AgentError extends Error {}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0, costUsd: 0, unpricedCalls: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    webSearches: a.webSearches + b.webSearches,
    costUsd: a.costUsd + b.costUsd,
    unpricedCalls: (a.unpricedCalls ?? 0) + (b.unpricedCalls ?? 0),
  };
}

let hubMapCache: string | null = null;
function hubMapDoc(): string {
  if (hubMapCache === null) {
    try {
      hubMapCache = fs.readFileSync(path.join(process.cwd(), "reference", "hub-map-and-page-factory.md"), "utf8");
    } catch {
      hubMapCache = "(reference/hub-map-and-page-factory.md not found)";
    }
  }
  return hubMapCache;
}

export function fillPrompt(prompt: string): string {
  return prompt.replaceAll("{{TODAY}}", new Date().toISOString().slice(0, 10)).replaceAll("{{HUB_MAP_DOC}}", hubMapDoc());
}

export function missingKey(envVar: string, provider: string): AgentError {
  return new AgentError(`No ${provider} API key found. Add ${envVar} to .env.local, restart the server, then retry.`);
}

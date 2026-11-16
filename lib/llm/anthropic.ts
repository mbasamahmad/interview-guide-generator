import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Usage } from "../store";
import { estimateCost } from "../pricing";
import { AgentError, addUsage, emptyUsage, missingKey, type ProviderAdapter, type WebSource } from "./common";
import { CLAUDE_MODELS } from "../agents/defaults";

// Credentials resolve from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
const g = globalThis as unknown as { __anthropic?: Anthropic };
function client(): Anthropic {
  if (!g.__anthropic) {
    try {
      g.__anthropic = new Anthropic({ timeout: 30 * 60 * 1000, maxRetries: 3 });
    } catch {
      throw missingKey("ANTHROPIC_API_KEY", "Claude");
    }
  }
  return g.__anthropic;
}

// Server-side refusal fallback: on a policy decline the API re-runs the request on
// its default fallback model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Cost estimates use the shared price table in lib/pricing.ts (not billing).
function usageOf(msg: Anthropic.Beta.BetaMessage): Usage {
  const u = msg.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const cost = estimateCost({
    provider: "anthropic",
    model: msg.model,
    inputTokens: u.input_tokens,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    outputTokens: u.output_tokens,
    webSearches: searches,
  });
  return {
    inputTokens: u.input_tokens + cacheWrite,
    outputTokens: u.output_tokens,
    cacheReadTokens: cacheRead,
    webSearches: searches,
    costUsd: cost ?? 0,
    unpricedCalls: cost === null ? 1 : 0,
  };
}

function checkStop(msg: Anthropic.Beta.BetaMessage, what: string) {
  if (msg.stop_reason === "refusal") throw new AgentError(`${what}: the model declined this request (category: ${msg.stop_details?.category ?? "unspecified"}).`);
  if (msg.stop_reason === "max_tokens") throw new AgentError(`${what}: output hit the max_tokens limit and was truncated.`);
}

const textOf = (msg: Anthropic.Beta.BetaMessage) =>
  msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");

function collectSources(msg: Anthropic.Beta.BetaMessage, into: Map<string, WebSource>) {
  for (const block of msg.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (!into.has(r.url)) into.set(r.url, { url: r.url, title: r.title, pageAge: r.page_age ?? "unknown" });
    } else if (block.type === "text" && block.citations) {
      for (const c of block.citations)
        if (c.type === "web_search_result_location" && !into.has(c.url)) into.set(c.url, { url: c.url, title: c.title ?? c.url, pageAge: "unknown" });
    }
  }
}

export const anthropicAdapter: ProviderAdapter = {
  async structuredText(o) {
    const system: Anthropic.Beta.BetaTextBlockParam[] = o.system.map((text, i) => ({
      type: "text",
      text,
      ...(i === o.system.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    const msg = await client()
      .beta.messages.stream({
        model: o.cfg.model,
        max_tokens: o.maxTokens ?? 64000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system,
        output_config: { effort: o.cfg.effort, format: betaZodOutputFormat(o.schema) },
        messages: [{ role: "user", content: o.user }],
      })
      .finalMessage();
    checkStop(msg, o.label);
    return { text: textOf(msg), usage: usageOf(msg) };
  },

  async webResearch(o) {
    let usage = emptyUsage();
    const sources = new Map<string, WebSource>();
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: o.task }];
    let notes = "";
    for (let turn = 0; turn < 8; turn++) {
      const msg = await client()
        .beta.messages.stream({
          model: o.cfg.model,
          max_tokens: 64000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: o.system,
          output_config: { effort: o.cfg.effort },
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: o.maxSearches },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15 },
          ],
          messages,
        })
        .finalMessage();
      usage = addUsage(usage, usageOf(msg));
      collectSources(msg, sources);
      notes += textOf(msg);
      if (msg.stop_reason === "pause_turn") {
        // Long server-tool turn: send it back so the server continues where it stopped.
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      checkStop(msg, `${o.label} (research)`);
      break;
    }
    return { notes, sources: [...sources.values()], usage };
  },

  async listModels() {
    const ids: string[] = [];
    for await (const m of client().models.list()) ids.push(m.id);
    return ids.length ? ids : CLAUDE_MODELS;
  },

  async defaultModel() {
    return CLAUDE_MODELS[0];
  },
};

export function describeAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.local and restart the server.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Retry this step in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API (network error). Retry this step.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  if (err instanceof Error && err.message.includes("Could not resolve authentication method")) return missingKey("ANTHROPIC_API_KEY", "Claude").message;
  return null;
}

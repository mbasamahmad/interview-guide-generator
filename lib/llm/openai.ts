import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response } from "openai/resources/responses/responses";
import type { Usage } from "../store";
import { estimateCost } from "../pricing";
import { AgentError, missingKey, type ProviderAdapter, type WebSource } from "./common";

const g = globalThis as unknown as { __openai?: OpenAI };
function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw missingKey("OPENAI_API_KEY", "OpenAI");
  return (g.__openai ??= new OpenAI({ timeout: 30 * 60 * 1000, maxRetries: 3 }));
}

function usageOf(r: Response): Usage {
  const u = r.usage;
  const searches = r.output.filter((o) => o.type === "web_search_call").length;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const tokens = { inputTokens: (u?.input_tokens ?? 0) - cached, outputTokens: u?.output_tokens ?? 0, cacheReadTokens: cached, webSearches: searches };
  const cost = estimateCost({ provider: "openai", model: r.model, ...tokens });
  return { ...tokens, costUsd: cost ?? 0, unpricedCalls: cost === null ? 1 : 0 };
}

function check(r: Response, what: string) {
  if (r.status === "incomplete") {
    const reason = r.incomplete_details?.reason ?? "unknown";
    throw new AgentError(
      reason === "max_output_tokens"
        ? `${what}: output hit the token limit and was truncated.`
        : `${what}: OpenAI stopped the response early (${reason}).`,
    );
  }
  if (r.status === "failed") throw new AgentError(`${what}: OpenAI reported the response as failed${r.error ? `: ${r.error.message}` : ""}.`);
  const refusal = r.output
    .flatMap((o) => (o.type === "message" ? o.content : []))
    .find((c) => c.type === "refusal");
  if (refusal && refusal.type === "refusal") throw new AgentError(`${what}: the model declined this request: ${refusal.refusal}`);
}

export const openaiAdapter: ProviderAdapter = {
  async structuredText(o) {
    const r = await client()
      .responses.stream({
        model: o.cfg.model,
        instructions: o.system.join("\n\n"),
        input: o.user,
        max_output_tokens: o.maxTokens ?? 64000,
        reasoning: { effort: o.cfg.effort },
        text: { format: zodTextFormat(o.schema, "output") },
      })
      .finalResponse();
    check(r, o.label);
    return { text: r.output_text, usage: usageOf(r) };
  },

  async webResearch(o) {
    const r = await client()
      .responses.stream({
        model: o.cfg.model,
        instructions: o.system,
        input: o.task,
        max_output_tokens: 64000,
        reasoning: { effort: o.cfg.effort },
        tools: [{ type: "web_search" }],
      })
      .finalResponse();
    check(r, `${o.label} (research)`);
    const sources = new Map<string, WebSource>();
    for (const item of r.output) {
      if (item.type !== "message") continue;
      for (const c of item.content) {
        if (c.type !== "output_text") continue;
        for (const a of c.annotations)
          if (a.type === "url_citation" && !sources.has(a.url)) sources.set(a.url, { url: a.url, title: a.title || a.url, pageAge: "unknown" });
      }
    }
    return { notes: r.output_text, sources: [...sources.values()], usage: usageOf(r) };
  },

  async listModels() {
    const ids: string[] = [];
    for await (const m of client().models.list()) ids.push(m.id);
    // Keep text-generation families; drop embeddings, audio, image and moderation models.
    return ids.filter((id) => !/embedding|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search-preview/.test(id)).sort();
  },

  async defaultModel() {
    const all: { id: string; created: number }[] = [];
    for await (const m of client().models.list()) all.push({ id: m.id, created: m.created });
    // Newest general GPT / o-series alias: skip small, specialty, preview and dated snapshot ids.
    const candidates = all
      .filter((m) => /^(gpt-\d|o\d)/.test(m.id))
      .filter((m) => !/mini|nano|audio|realtime|search|transcribe|tts|image|instruct|codex|preview|chat|oss|\d{4}-\d{2}-\d{2}/.test(m.id))
      .sort((a, b) => b.created - a.created);
    return candidates[0]?.id ?? null;
  },
};

export function describeOpenAIError(err: unknown): string | null {
  if (err instanceof OpenAI.AuthenticationError) return "OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local and restart the server.";
  if (err instanceof OpenAI.RateLimitError) return "Rate limited by the OpenAI API. Retry this step in a minute.";
  if (err instanceof OpenAI.NotFoundError) return `OpenAI does not recognize this model: ${err.message}`;
  if (err instanceof OpenAI.BadRequestError) return `OpenAI rejected the request: ${err.message}`;
  if (err instanceof OpenAI.APIConnectionError) return "Could not reach the OpenAI API (network error). Retry this step.";
  if (err instanceof OpenAI.APIError) return `OpenAI API error ${err.status}: ${err.message}`;
  return null;
}

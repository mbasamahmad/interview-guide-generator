import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponse, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { z } from "zod";
import type { Effort } from "../agents/defaults";
import type { Usage } from "../store";
import { estimateCost } from "../pricing";
import { AgentError, missingKey, type ProviderAdapter, type WebSource } from "./common";

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const g = globalThis as unknown as { __gemini?: GoogleGenAI };
function client(): GoogleGenAI {
  const key = apiKey();
  if (!key) throw missingKey("GEMINI_API_KEY", "Gemini");
  return (g.__gemini ??= new GoogleGenAI({ apiKey: key }));
}

const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

function usageOf(model: string, u: GenerateContentResponseUsageMetadata | undefined, searches: number): Usage {
  const cached = u?.cachedContentTokenCount ?? 0;
  const tokens = {
    inputTokens: (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0) - cached,
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    webSearches: searches,
  };
  const cost = estimateCost({ provider: "gemini", model, ...tokens });
  return { ...tokens, costUsd: cost ?? 0, unpricedCalls: cost === null ? 1 : 0 };
}

/** Stream a response and collect text, usage, finish reason and grounding sources. */
async function run(
  params: Parameters<GoogleGenAI["models"]["generateContentStream"]>[0],
  what: string,
): Promise<{ text: string; usage: Usage; sources: WebSource[] }> {
  const stream = await client().models.generateContentStream(params);
  let text = "";
  let usage: GenerateContentResponseUsageMetadata | undefined;
  let finish: string | undefined;
  let blocked: string | undefined;
  const queries = new Set<string>();
  const sources = new Map<string, WebSource>();
  for await (const chunk of stream as AsyncGenerator<GenerateContentResponse>) {
    text += chunk.text ?? "";
    usage = chunk.usageMetadata ?? usage;
    blocked = chunk.promptFeedback?.blockReason ?? blocked;
    const cand = chunk.candidates?.[0];
    finish = cand?.finishReason ?? finish;
    for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) queries.add(q);
    for (const gc of cand?.groundingMetadata?.groundingChunks ?? []) {
      const uri = gc.web?.uri;
      if (uri && !sources.has(uri)) sources.set(uri, { url: uri, title: gc.web?.title || uri, pageAge: "unknown" });
    }
  }
  if (blocked) throw new AgentError(`${what}: Gemini blocked the prompt (${blocked}).`);
  if (finish === "MAX_TOKENS") throw new AgentError(`${what}: output hit the token limit and was truncated.`);
  if (finish && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(finish)) throw new AgentError(`${what}: Gemini stopped early (${finish}).`);
  return { text, usage: usageOf(String(params.model), usage, queries.size), sources: [...sources.values()] };
}

/** JSON Schema for responseJsonSchema; Gemini does not need the $schema marker. */
function jsonSchema(schema: z.ZodType): unknown {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export const geminiAdapter: ProviderAdapter = {
  async structuredText(o) {
    const r = await run(
      {
        model: o.cfg.model,
        contents: o.user,
        config: {
          systemInstruction: o.system.join("\n\n"),
          maxOutputTokens: o.maxTokens ?? 64000,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema(o.schema),
          thinkingConfig: { thinkingLevel: THINKING[o.cfg.effort] },
        },
      },
      o.label,
    );
    return { text: r.text, usage: r.usage };
  },

  async webResearch(o) {
    const r = await run(
      {
        model: o.cfg.model,
        contents: o.task,
        config: {
          systemInstruction: o.system,
          maxOutputTokens: 64000,
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: THINKING[o.cfg.effort] },
        },
      },
      `${o.label} (research)`,
    );
    return { notes: r.text, sources: r.sources, usage: r.usage };
  },

  async listModels() {
    const ids: string[] = [];
    const pager = await client().models.list();
    for await (const m of pager) {
      if (m.name && (m.supportedActions ?? []).includes("generateContent")) ids.push(m.name.replace(/^models\//, ""));
    }
    return ids.filter((id) => !/embedding|image|tts|audio|live|aqa/.test(id)).sort();
  },

  async defaultModel() {
    const ids = await geminiAdapter.listModels();
    const version = (id: string) => parseFloat(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
    const tier = (id: string) => (/pro/.test(id) ? 2 : /flash/.test(id) ? 1 : 0);
    // Newest stable Gemini, preferring Pro over Flash: skip preview, experimental, lite and numbered snapshots.
    const stable = ids.filter((id) => /^gemini-\d/.test(id) && !/preview|exp|lite|latest|-\d{3}$/.test(id));
    stable.sort((a, b) => version(b) - version(a) || tier(b) - tier(a));
    return stable[0] ?? null;
  },
};

export function describeGeminiError(err: unknown): string | null {
  if (err instanceof ApiError) {
    if (err.status === 400 && /API key/i.test(err.message)) return "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local and restart the server.";
    if (err.status === 429) return "Rate limited by the Gemini API. Retry this step in a minute.";
    if (err.status === 404) return `Gemini does not recognize this model: ${err.message}`;
    return `Gemini API error ${err.status}: ${err.message}`;
  }
  return null;
}

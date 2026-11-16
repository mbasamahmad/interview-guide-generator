// Agent registry: metadata only. Each agent's prompt lives in agents/<key>/prompt.md
// (the live prompt, overwritten by the Prompts page) and agents/<key>/prompt.default.md
// (the original). Provider, model, effort and enabled live in agents/<key>/config.json.

export type AgentKey = "company" | "role" | "interview" | "coding" | "writer" | "interactive" | "seo" | "qa";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Provider = "anthropic" | "openai" | "gemini";

export const PROVIDERS: { id: Provider; label: string; envVar: string }[] = [
  { id: "anthropic", label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "gemini", label: "Gemini (Google)", envVar: "GEMINI_API_KEY" },
];

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Claude models offered when the model list can't be fetched. */
export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

export interface AgentDef {
  key: AgentKey;
  name: string;
  description: string;
  usesWeb: boolean;
  canDisable: boolean;
  defaultProvider: Provider;
  defaultModel: string;
  defaultEffort: Effort;
}

const claude = (model: string, effort: Effort) => ({ defaultProvider: "anthropic" as const, defaultModel: model, defaultEffort: effort });

export const AGENTS: AgentDef[] = [
  { key: "company", name: "Company Research Agent", description: "Background, products, tech stack, engineering culture, values, teams, recent developments.", usesWeb: true, canDisable: false, ...claude("claude-opus-5-5", "high") },
  { key: "role", name: "Role Research Agent", description: "Discovers the engineering roles the company hires for, with skills and level expectations for each.", usesWeb: true, canDisable: false, ...claude("claude-opus-5-5", "high") },
  { key: "interview", name: "Interview Research Agent", description: "Discovers the interview loop: each round's type, which roles it applies to, format, length, AI rules, prep strategy.", usesWeb: true, canDisable: false, ...claude("claude-opus-5-5", "high") },
  { key: "coding", name: "Coding Questions Research Agent", description: "Discovers the coding topics the company emphasizes, then writes questions with original, complete solutions.", usesWeb: true, canDisable: true, ...claude("claude-opus-5-5", "high") },
  { key: "writer", name: "Content Writing Agent", description: "Writes each guide page from the structured research, following the Hub Map page model.", usesWeb: false, canDisable: false, ...claude("claude-opus-5-5", "medium") },
  { key: "interactive", name: "Interactive Content Agent", description: "Adds Markdown-compatible interactive elements: collapsible solutions, checklists, tables, nav.", usesWeb: false, canDisable: true, ...claude("claude-opus-5-5", "low") },
  { key: "seo", name: "SEO Optimization Agent", description: "Per-page title, meta, keywords, intent, slug, headings, internal links and alt text.", usesWeb: false, canDisable: true, ...claude("claude-opus-5-5", "low") },
  { key: "qa", name: "Proofreading & QA Agent", description: "Fixes grammar, clarity, technical errors, code and complexity, unsupported claims, formatting.", usesWeb: false, canDisable: true, ...claude("claude-opus-5-5", "medium") },
];

export const AGENT_BY_KEY = Object.fromEntries(AGENTS.map((a) => [a.key, a])) as Record<AgentKey, AgentDef>;

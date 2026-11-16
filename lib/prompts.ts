import fs from "fs";
import path from "path";
import { AGENTS, AGENT_BY_KEY, EFFORTS, PROVIDERS, type AgentKey, type Effort, type Provider } from "./agents/defaults";
import { writeJsonAtomic, writeTextAtomic } from "./fsutil";

// Each agent's prompt is a file: agents/<key>/prompt.md. It is read fresh on every
// call, so edits from the Prompts page or from an editor apply to the next step.
// Saving from the UI overwrites prompt.md / config.json; the previous text is kept
// as a numbered snapshot in data/prompt-history/<key>/ for version history and restore.

const AGENTS_DIR = path.join(process.cwd(), "agents");
const HISTORY_DIR = path.join(process.cwd(), "data", "prompt-history");

export interface PromptVersion {
  version: number;
  prompt: string;
  provider: Provider;
  model: string;
  effort: Effort;
  savedAt: string;
  note: string;
}

export interface AgentConfig {
  key: AgentKey;
  prompt: string;
  provider: Provider;
  model: string;
  effort: Effort;
  enabled: boolean;
  version: number;
  updatedAt: string;
  promptFile: string;
  versions: PromptVersion[];
}

type FileConfig = { provider: Provider; model: string; effort: Effort; enabled: boolean };

const dir = (key: AgentKey) => path.join(AGENTS_DIR, key);
const promptPath = (key: AgentKey) => path.join(dir(key), "prompt.md");
const defaultPromptPath = (key: AgentKey) => path.join(dir(key), "prompt.default.md");
const configPath = (key: AgentKey) => path.join(dir(key), "config.json");
const historyDir = (key: AgentKey) => path.join(HISTORY_DIR, key);

export function defaultPrompt(key: AgentKey): string {
  try {
    return fs.readFileSync(defaultPromptPath(key), "utf8");
  } catch {
    throw new Error(`Missing ${path.relative(process.cwd(), defaultPromptPath(key))}; it holds the agent's default prompt.`);
  }
}

function defaultFileConfig(key: AgentKey): FileConfig {
  const d = AGENT_BY_KEY[key];
  return { provider: d.defaultProvider, model: d.defaultModel, effort: d.defaultEffort, enabled: true };
}

function readFileConfig(key: AgentKey): FileConfig {
  const def = defaultFileConfig(key);
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(key), "utf8")) as Partial<FileConfig>;
    return {
      provider: PROVIDERS.some((p) => p.id === raw.provider) ? (raw.provider as Provider) : def.provider,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : def.model,
      effort: EFFORTS.includes(raw.effort as Effort) ? (raw.effort as Effort) : def.effort,
      enabled: AGENT_BY_KEY[key].canDisable ? raw.enabled !== false : true,
    };
  } catch {
    writeJsonAtomic(configPath(key), def);
    return def;
  }
}

function readPromptFile(key: AgentKey): { text: string; mtime: string } {
  if (!fs.existsSync(promptPath(key))) writeTextAtomic(promptPath(key), defaultPrompt(key));
  return { text: fs.readFileSync(promptPath(key), "utf8"), mtime: fs.statSync(promptPath(key)).mtime.toISOString() };
}

function readHistory(key: AgentKey): PromptVersion[] {
  try {
    return fs
      .readdirSync(historyDir(key))
      .filter((f) => /^v\d+\.json$/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(path.join(historyDir(key), f), "utf8")) as PromptVersion)
      .sort((a, b) => a.version - b.version);
  } catch {
    return [];
  }
}

function snapshot(key: AgentKey, v: Omit<PromptVersion, "version" | "savedAt">, history: PromptVersion[]): PromptVersion {
  const entry: PromptVersion = { ...v, version: (history.at(-1)?.version ?? 0) + 1, savedAt: new Date().toISOString() };
  writeJsonAtomic(path.join(historyDir(key), `v${entry.version}.json`), entry);
  return entry;
}

const same = (a: Pick<PromptVersion, "prompt" | "provider" | "model" | "effort">, b: Pick<PromptVersion, "prompt" | "provider" | "model" | "effort">) =>
  a.prompt === b.prompt && a.provider === b.provider && a.model === b.model && a.effort === b.effort;

export function getAgentConfig(key: AgentKey): AgentConfig {
  const cfg = readFileConfig(key);
  const { text, mtime } = readPromptFile(key);
  const history = readHistory(key);
  const current = { prompt: text, provider: cfg.provider, model: cfg.model, effort: cfg.effort };
  // Record the current files as a version if they differ from the last snapshot
  // (first run, or prompt.md / config.json edited outside the app).
  if (!history.length || !same(history.at(-1)!, current)) {
    history.push(snapshot(key, { ...current, note: history.length ? "Edited on disk" : "Initial" }, history));
  }
  return {
    key,
    ...current,
    enabled: cfg.enabled,
    version: history.at(-1)!.version,
    updatedAt: mtime,
    promptFile: path.relative(process.cwd(), promptPath(key)),
    versions: history,
  };
}

export function getAgentConfigs(): AgentConfig[] {
  return AGENTS.map((a) => getAgentConfig(a.key));
}

export function saveAgentConfig(
  key: AgentKey,
  patch: { prompt?: string; provider?: Provider; model?: string; effort?: Effort; enabled?: boolean; note?: string },
): AgentConfig {
  const def = AGENT_BY_KEY[key];
  const cur = getAgentConfig(key);
  if (patch.enabled === false && !def.canDisable) throw new Error(`${def.name} is required and cannot be disabled.`);
  if (patch.prompt !== undefined && !patch.prompt.trim()) throw new Error("Prompt cannot be empty.");
  if (patch.provider !== undefined && !PROVIDERS.some((p) => p.id === patch.provider)) throw new Error("Unknown provider.");
  if (patch.effort !== undefined && !EFFORTS.includes(patch.effort)) throw new Error("Unknown effort level.");
  if (patch.model !== undefined && !/^[\w.\-:/]{1,100}$/.test(patch.model.trim())) throw new Error("Enter a valid model name.");

  const next = {
    prompt: patch.prompt ?? cur.prompt,
    provider: patch.provider ?? cur.provider,
    model: patch.model?.trim() ?? cur.model,
    effort: patch.effort ?? cur.effort,
  };
  if (!same(next, cur)) {
    snapshot(key, { ...next, note: patch.note?.trim() || "Edited in app" }, cur.versions);
    if (next.prompt !== cur.prompt) writeTextAtomic(promptPath(key), next.prompt);
  }
  writeJsonAtomic(configPath(key), {
    provider: next.provider,
    model: next.model,
    effort: next.effort,
    enabled: patch.enabled ?? cur.enabled,
  } satisfies FileConfig);
  return getAgentConfig(key);
}

export function restoreAgentVersion(key: AgentKey, version: number | "default"): AgentConfig {
  const cur = getAgentConfig(key);
  if (version === "default") {
    const d = defaultFileConfig(key);
    return saveAgentConfig(key, { prompt: defaultPrompt(key), provider: d.provider, model: d.model, effort: d.effort, note: "Restored default" });
  }
  const v = cur.versions.find((x) => x.version === version);
  if (!v) throw new Error(`Version ${version} not found.`);
  return saveAgentConfig(key, { prompt: v.prompt, provider: v.provider, model: v.model, effort: v.effort, note: `Restored v${version}` });
}

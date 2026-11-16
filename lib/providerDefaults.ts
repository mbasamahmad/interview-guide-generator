import path from "path";
import { EFFORTS, PROVIDERS, type Effort, type Provider } from "./agents/defaults";
import { readJson, writeJsonAtomic } from "./fsutil";

// agents/providers.json holds the global model settings:
// - defaultModels: the model each provider uses when an agent falls back to it
//   (its own provider has no key). Empty = pick automatically.
// - global: "auto" = each agent uses its own settings (with key fallback);
//   "all" = every agent runs on global.provider / global.model (and global.effort if set).

const FILE = path.join(process.cwd(), "agents", "providers.json");

export type ProviderDefaults = Record<Provider, string>;
export type GlobalMode = "auto" | "all";
export interface GlobalConfig {
  mode: GlobalMode;
  provider: Provider | "";
  model: string;
  /** "" = keep each agent's own effort. */
  effort: Effort | "";
}

type FileShape = { defaultModels?: Partial<ProviderDefaults>; global?: Partial<GlobalConfig> };

const read = (): FileShape => readJson<FileShape>(FILE) ?? {};
const validModel = (m: string) => !m || /^[\w.\-:/]{1,100}$/.test(m);

export function readProviderDefaults(): ProviderDefaults {
  const raw = read().defaultModels ?? {};
  return Object.fromEntries(PROVIDERS.map((p) => [p.id, typeof raw[p.id] === "string" ? raw[p.id]!.trim() : ""])) as ProviderDefaults;
}

export function readGlobalConfig(): GlobalConfig {
  const g = read().global ?? {};
  return {
    mode: g.mode === "all" ? "all" : "auto",
    provider: PROVIDERS.some((p) => p.id === g.provider) ? (g.provider as Provider) : "",
    model: typeof g.model === "string" ? g.model.trim() : "",
    effort: EFFORTS.includes(g.effort as Effort) ? (g.effort as Effort) : "",
  };
}

export function saveProviderDefault(provider: Provider, model: string): ProviderDefaults {
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Unknown provider.");
  if (!validModel(model.trim())) throw new Error("Enter a valid model name.");
  const file = read();
  const next = { ...readProviderDefaults(), [provider]: model.trim() };
  writeJsonAtomic(FILE, { ...file, defaultModels: next });
  return next;
}

export function saveGlobalConfig(patch: Partial<GlobalConfig>): GlobalConfig {
  const next = { ...readGlobalConfig(), ...patch };
  if (next.mode !== "auto" && next.mode !== "all") throw new Error("Unknown mode.");
  if (next.provider && !PROVIDERS.some((p) => p.id === next.provider)) throw new Error("Unknown provider.");
  if (!validModel(next.model)) throw new Error("Enter a valid model name.");
  if (next.effort && !EFFORTS.includes(next.effort)) throw new Error("Unknown effort level.");
  if (next.mode === "all" && !next.provider) throw new Error("Choose a provider for all agents.");
  const file = read();
  writeJsonAtomic(FILE, { ...file, global: next });
  return next;
}

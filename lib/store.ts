import fs from "fs";
import path from "path";
import type { AgentKey, Provider } from "./agents/defaults";
import { readJson, writeJsonAtomic } from "./fsutil";

// Run state persistence: one JSON file per run in data/runs/. Writes are atomic.

const DATA_DIR = path.join(process.cwd(), "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");

function ensureDirs() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

// ---------------------------------------------------------------- runs

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  costUsd: number;
  /** Calls whose cost is not estimated (providers without a price table). */
  unpricedCalls: number;
}

export interface Step {
  key: string;
  label: string;
  group: string;
  agent?: AgentKey;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  warnings?: string[];
  promptVersion?: number;
  provider?: Provider;
  model?: string;
  /** Set when the agent's own provider had no key and this step ran on another provider. */
  fallbackFrom?: Provider;
  /** Set when the global "one model for all agents" setting chose the provider/model. */
  global?: boolean;
  usage?: Usage;
}

/** The only user input is the company; roles and interview types are discovered. */
/** The company's row from the company sheet (keyword plan for its landing page). Empty strings when a cell is blank. */
export interface SheetInfo {
  keyword: string;
  searchVolume: number | null;
  svLabel: string;
  url: string; // the sheet's Slug column, e.g. "/interview/companies/anthropic/"
  secondaryKeywords: string[];
  h1: string;
  metaTitle: string;
  metaDescription: string;
}

export interface RunInput {
  company: string;
  companySlug: string;
  /** Saved from the company sheet when the company is in it. */
  sheet?: SheetInfo;
}

/** What the user picked after discovery: which roles and interview types get pages. */
export interface Selection {
  roles: string[];
  interviewTypes: string[];
  confirmedAt: string;
}

export interface PlannedPage {
  path: string;
  kind: "landing" | "study";
  pageType: string;
  title: string;
  purpose: string;
  sections: string[];
  /** Keys into run.artifacts that this page draws on. */
  inputs: string[];
  /** Extra criteria, e.g. interview type or coding topic. */
  criteria: Record<string, string>;
  /** Fields consumed by the landing-page frontmatter. */
  parent: string;
  url: string;
}

export interface RunState {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "running" | "awaiting-selection" | "done" | "failed";
  input: RunInput;
  selection?: Selection;
  /** The last confirmed choice, kept when re-running role research sends the run back to choosing. */
  previousSelection?: Selection;
  /** Research parts re-run since the pages were written; pages that use them are rewritten at the next plan. */
  pendingRewrite?: string[];
  steps: Record<string, Step>;
  stepOrder: string[];
  artifacts: Record<string, unknown>;
  pages: PlannedPage[];
  /** Working copies of each page through the pipeline: pageDrafts[path][stage]. */
  pageDrafts: Record<string, Record<string, unknown>>;
  files: Record<string, string>;
  log: string[];
  error?: string;
  /** How many times the run resumed itself after a server restart. */
  autoResumes?: number;
}

function runFile(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid run id");
  return path.join(RUNS_DIR, `${id}.json`);
}

const g = globalThis as unknown as { __runCache?: Map<string, RunState> };
const cache = (g.__runCache ??= new Map<string, RunState>());

export function createRun(input: RunInput): RunState {
  const id = `${input.companySlug}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const run: RunState = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    input,
    steps: {},
    stepOrder: [],
    artifacts: {},
    pages: [],
    pageDrafts: {},
    files: {},
    log: [],
  };
  cache.set(id, run);
  writeJsonAtomic(runFile(id), run);
  return run;
}

export function getRun(id: string): RunState | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const run = readJson<RunState>(runFile(id));
  if (run) cache.set(id, run);
  return run;
}

/** Mutate a run in place and persist it. */
export function updateRun(id: string, fn: (run: RunState) => void): RunState {
  const run = getRun(id);
  if (!run) throw new Error(`Run ${id} not found`);
  fn(run);
  run.updatedAt = new Date().toISOString();
  writeJsonAtomic(runFile(id), run);
  return run;
}

export function listRuns(): Pick<RunState, "id" | "createdAt" | "status" | "input">[] {
  ensureDirs();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => getRun(f.replace(/\.json$/, "")))
    .filter((r): r is RunState => !!r)
    .map((r) => ({ id: r.id, createdAt: r.createdAt, status: r.status, input: r.input }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

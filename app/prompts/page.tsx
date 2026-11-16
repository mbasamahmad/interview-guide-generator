"use client";

import { useEffect, useMemo, useState } from "react";

type Version = { version: number; prompt: string; provider: string; model: string; effort: string; savedAt: string; note: string };
type Config = {
  key: string; prompt: string; provider: string; model: string; effort: string; enabled: boolean;
  version: number; updatedAt: string; promptFile: string; versions: Version[];
};
type Effective = { provider: string; model: string; effort: string; fallbackFrom: string | null; global: boolean };
type GlobalConfig = { mode: "auto" | "all"; provider: string; model: string; effort: string };
type Agent = { key: string; name: string; description: string; usesWeb: boolean; canDisable: boolean; config: Config; effective: Effective };
type ProviderInfo = { id: string; label: string; envVar: string; configured: boolean; defaultModel: { model: string | null; source: "configured" | "auto" } };
type Tab = "prompt" | "history" | "test";

const CUSTOM = "__custom__";

const SAMPLE_PAGE = `# Stripe system design interview

Stripe's system design round is 60 minutes and focuses on payments infrastructure. Candidates report questions like designing an idempotent payments API.

## What they look for
Stripe always asks about rate limiting and you must know Kafka.

## Example question
Design a rate limiter. Use a token bucket; it runs in O(n) time per request.
`;

function sampleInput(a: Agent) {
  if (a.key === "interview" || a.key === "coding")
    return JSON.stringify({ company: "Stripe", roles: [{ slug: "software-engineer", title: "Software Engineer" }, { slug: "machine-learning-engineer", title: "Machine Learning Engineer" }] }, null, 2);
  if (a.usesWeb) return JSON.stringify({ company: "Stripe" }, null, 2);
  if (a.key === "writer")
    return `<page_spec>\nPath: study-guide/preparation-guides/common-mistakes.md\nKind: Study page\nPurpose: Mistakes per round and per role, and how to avoid them.\nCompany: Stripe\nRoles in this package: Software Engineer (software-engineer)\nAudience: candidates at every level (entry to staff)\n</page_spec>\n\n<research>\n(Paste research JSON here, or leave this and let the agent note the gaps.)\n</research>`;
  return SAMPLE_PAGE;
}

const PROVIDER_SHORT: Record<string, string> = { anthropic: "Claude", openai: "OpenAI", gemini: "Gemini" };
const providerShort = (p: string) => PROVIDER_SHORT[p] ?? p;

function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export default function PromptsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [efforts, setEfforts] = useState<string[]>([]);
  const [global, setGlobal] = useState<GlobalConfig>({ mode: "auto", provider: "", model: "", effort: "" });
  const [models, setModels] = useState<Record<string, { list: string[]; warning?: string }>>({});
  const [sel, setSel] = useState<string>("");
  const [tab, setTab] = useState<Tab>("prompt");
  const [draft, setDraft] = useState({ prompt: "", provider: "", model: "", effort: "", note: "" });
  const [customModel, setCustomModel] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState("");
  const [viewVersion, setViewVersion] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/prompts", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setLoadError(d.error);
        setAgents(d.agents);
        setProviders(d.providers);
        setEfforts(d.efforts);
        setGlobal(d.global);
        if (d.agents[0]) select(d.agents[0], true);
        // Load model lists for every keyed provider (used by the default-model card).
        for (const p of d.providers as ProviderInfo[]) if (p.configured) loadModels(p.id);
      })
      .catch(() => setLoadError("Could not load prompts."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadModels(p: string) {
    fetch(`/api/models?provider=${p}`)
      .then((r) => r.json())
      .then((d) => setModels((m) => ({ ...m, [p]: { list: d.models ?? [], warning: d.warning } })))
      .catch(() => setModels((m) => ({ ...m, [p]: { list: [], warning: "Could not load models." } })));
  }

  /** Refresh agents and providers (effective models change when defaults or configs change). */
  async function refresh() {
    const d = await (await fetch("/api/prompts", { cache: "no-store" })).json();
    if (d.error) return;
    setAgents(d.agents);
    setProviders(d.providers);
    setGlobal(d.global);
    // Keep the open agent's editor in sync if its saved config changed (e.g. "write to every agent").
    const open = (d.agents as Agent[]).find((a) => a.key === sel);
    if (open) setDraft((dr) => (dr.prompt === open.config.prompt ? { ...dr, provider: open.config.provider, model: open.config.model, effort: open.config.effort } : dr));
  }

  async function setProviderDefault(provider: string, model: string) {
    const res = await fetch("/api/providers", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model }) });
    if (!res.ok) return setMsg({ kind: "err", text: (await res.json().catch(() => ({}))).error ?? "Could not save the default model." });
    await refresh();
  }

  // Fetch the model list for the selected provider (again after "Refresh").
  useEffect(() => {
    const p = draft.provider;
    if (!p || models[p]) return;
    loadModels(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.provider, models]);

  const agent = useMemo(() => agents.find((a) => a.key === sel), [agents, sel]);
  const dirty =
    !!agent &&
    (draft.prompt !== agent.config.prompt || draft.provider !== agent.config.provider || draft.model !== agent.config.model || draft.effort !== agent.config.effort);
  const providerInfo = providers.find((p) => p.id === draft.provider);
  const modelsLoading = !!draft.provider && !models[draft.provider];
  const modelOptions = useMemo(() => {
    const list = models[draft.provider]?.list ?? [];
    return draft.model && !list.includes(draft.model) ? [draft.model, ...list] : list;
  }, [models, draft.provider, draft.model]);

  // After switching provider the model is cleared; pick that provider's first model once its list loads.
  useEffect(() => {
    const list = models[draft.provider]?.list;
    if (!draft.model && !customModel && list?.length) setDraft((d) => ({ ...d, model: list[0] }));
  }, [models, draft.provider, draft.model, customModel]);

  function select(a: Agent, force = false) {
    if (!force && dirty && !confirm("Discard unsaved changes to this prompt?")) return;
    setSel(a.key);
    setDraft({ prompt: a.config.prompt, provider: a.config.provider, model: a.config.model, effort: a.config.effort, note: "" });
    setTestInput(sampleInput(a));
    setTestOut("");
    setMsg(null);
    setViewVersion(null);
    setCustomModel(false);
  }

  async function call(method: "PUT" | "POST", body: object, okText: string) {
    if (!agent) return;
    setMsg(null);
    const res = await fetch(`/api/prompts/${agent.key}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) return setMsg({ kind: "err", text: d.error ?? "Save failed." });
    setAgents((xs) => xs.map((x) => (x.key === agent.key ? { ...x, config: d.config } : x)));
    setDraft({ prompt: d.config.prompt, provider: d.config.provider, model: d.config.model, effort: d.config.effort, note: "" });
    setCustomModel(false);
    setMsg({ kind: "ok", text: okText });
    refresh();
  }

  async function runTest() {
    if (!agent) return;
    setTesting(true);
    setTestOut("");
    try {
      const res = await fetch(`/api/prompts/${agent.key}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: draft.prompt, provider: draft.provider, model: draft.model, effort: draft.effort, input: testInput }),
      });
      const d = await res.json();
      if (!res.ok) setTestOut(`Error: ${d.error}`);
      else {
        const u = d.usage;
        const cost = u ? (u.unpricedCalls ? ` · ${u.inputTokens + u.cacheReadTokens} in / ${u.outputTokens} out tokens (not priced)` : ` · est. $${u.costUsd.toFixed(3)}`) : "";
        const md = typeof d.data?.markdown === "string" ? `${d.data.markdown}\n\n---\n` : "";
        setTestOut(`Finished in ${(d.ms / 1000).toFixed(0)}s${cost}\n\n${md}${JSON.stringify({ ...d.data, markdown: md ? "(shown above)" : undefined }, null, 2)}${d.notes ? `\n\n--- Research notes ---\n${d.notes}` : ""}`);
      }
    } catch {
      setTestOut("Error: could not reach the server.");
    } finally {
      setTesting(false);
    }
  }

  if (loadError) return <div className="errors">{loadError}</div>;
  if (!agents.length) return <p className="muted">Loading…</p>;

  const groups = [
    { title: "Research", items: agents.filter((a) => a.usesWeb) },
    { title: "Writing", items: agents.filter((a) => !a.usesWeb) },
  ];
  const modelHint = modelsLoading
    ? { kind: "muted", text: "Loading models…" }
    : models[draft.provider]?.warning
      ? { kind: "warn", text: `${models[draft.provider]!.warning}${models[draft.provider]!.list.length ? " Showing the built-in list." : ""}` }
      : { kind: "muted", text: `${models[draft.provider]?.list.length ?? 0} models from ${providerInfo?.label ?? draft.provider}` };

  return (
    <div className="pm">
      <header className="pm-head">
        <div>
          <h1>Agent prompts</h1>
          <p className="muted">
            Each prompt is a file at <span className="mono">agents/&lt;agent&gt;/prompt.md</span>. Saving overwrites it; edits made in an editor show up here. Changes apply to the next step that runs.
          </p>
        </div>
        <div className="key-status">
          {providers.map((p) => (
            <span key={p.id} className={`key-pill ${p.configured ? "ok" : ""}`} title={p.configured ? `${p.envVar} is set` : `Add ${p.envVar} to .env.local and restart`}>
              <i className="dot" />
              {providerShort(p.id)}
              <span className="muted">{p.configured ? "key set" : "no key"}</span>
            </span>
          ))}
        </div>
      </header>

      <GlobalCard
        providers={providers}
        models={models}
        efforts={efforts}
        global={global}
        agentCount={agents.length}
        onSaved={refresh}
        onError={(text) => setMsg({ kind: "err", text })}
        setProviderDefault={setProviderDefault}
      />

      <PricingCard modelsInUse={[...new Set(agents.map((a) => a.effective.model))]} />

      <div className="pm-body">
        <nav className="pm-nav">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="pm-nav-title">{g.title}</div>
              {g.items.map((a) => (
                <button key={a.key} className={`pm-item ${a.key === sel ? "active" : ""}`} onClick={() => select(a)}>
                  <span className={`status-dot ${a.config.enabled ? "on" : "off"}`} title={a.config.enabled ? "On" : "Off"} />
                  <span className="pm-item-text">
                    <span className="pm-item-name">{a.name.replace(/ Agent$/, "")}</span>
                    {a.effective.global ? (
                      <span className="pm-item-meta text-accent" title="Set by the global model">
                        {providerShort(a.effective.provider)} · {a.effective.model} · global
                      </span>
                    ) : a.effective.fallbackFrom ? (
                      <span className="pm-item-meta text-warn" title={`${providerShort(a.config.provider)} has no key, so this agent uses ${providerShort(a.effective.provider)}`}>
                        → {providerShort(a.effective.provider)} · {a.effective.model}
                      </span>
                    ) : (
                      <span className="pm-item-meta">
                        {providerShort(a.config.provider)} · {a.config.model} · v{a.config.version}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {agent && (
          <section className="pm-main panel">
            <div className="pm-title">
              <div>
                <h2>{agent.name}</h2>
                <p className="muted small">
                  {agent.description}
                  {agent.usesWeb ? " Uses the provider's web search." : ""}
                </p>
              </div>
              <label className={`toggle ${agent.canDisable ? "" : "locked"}`} title={agent.canDisable ? "Turn this agent on or off" : "Required: the run depends on this agent"}>
                <input
                  type="checkbox"
                  checked={agent.config.enabled}
                  disabled={!agent.canDisable}
                  onChange={(e) => call("PUT", { enabled: e.target.checked }, e.target.checked ? "Agent turned on." : "Agent turned off: its steps will be skipped.")}
                />
                <span className="track"><span className="thumb" /></span>
                <span className="small">{agent.canDisable ? (agent.config.enabled ? "On" : "Off") : "Always on"}</span>
              </label>
            </div>

            {agent.effective.global && (
              <div className="fallback-note info">
                The global model is on, so this agent runs on <b>{providerShort(agent.effective.provider)} · {agent.effective.model}</b>
                {global.effort ? ` at ${global.effort} effort` : ""}. Its own settings below are kept, and are used again when the global model is set back to &quot;Per agent&quot;.
              </div>
            )}
            {!agent.effective.global && agent.effective.fallbackFrom && (
              <div className="fallback-note">
                {providerShort(agent.effective.fallbackFrom)} has no API key, so this agent currently runs on{" "}
                <b>{providerShort(agent.effective.provider)} · {agent.effective.model}</b>. Its saved settings below are kept and are used again once the{" "}
                {providerShort(agent.effective.fallbackFrom)} key is added. To use the fallback permanently, switch the provider below and save.
              </div>
            )}

            <div className="settings">
              <div className="field">
                <label htmlFor="provider">Provider</label>
                <select
                  id="provider"
                  value={draft.provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setCustomModel(false);
                    setDraft({ ...draft, provider: p, model: p === agent.config.provider ? agent.config.model : "" });
                  }}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}{p.configured ? "" : " (no key)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="model">
                  Model
                  <button
                    className="icon-btn"
                    type="button"
                    disabled={modelsLoading}
                    title="Reload the model list from the provider"
                    onClick={() => setModels((m) => { const n = { ...m }; delete n[draft.provider]; return n; })}
                  >
                    ↻
                  </button>
                </label>
                {customModel ? (
                  <div className="input-group">
                    <input id="model" autoFocus value={draft.model} placeholder="Type a model name" onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
                    <button type="button" onClick={() => { setCustomModel(false); if (!modelOptions.includes(draft.model)) setDraft({ ...draft, model: modelOptions[0] ?? "" }); }}>
                      List
                    </button>
                  </div>
                ) : (
                  <select
                    id="model"
                    value={draft.model}
                    disabled={modelsLoading && modelOptions.length === 0}
                    onChange={(e) => (e.target.value === CUSTOM ? setCustomModel(true) : setDraft({ ...draft, model: e.target.value }))}
                  >
                    {!draft.model && <option value="">{modelsLoading ? "Loading models…" : "Choose a model"}</option>}
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}{m === agent.config.model && draft.provider === agent.config.provider ? " (saved)" : ""}
                      </option>
                    ))}
                    <option value={CUSTOM}>Custom model…</option>
                  </select>
                )}
              </div>
              <div className="field">
                <label htmlFor="effort">Effort</label>
                <select id="effort" value={draft.effort} onChange={(e) => setDraft({ ...draft, effort: e.target.value })}>
                  {efforts.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className={`settings-hint ${modelHint.kind}`}>
                {providerInfo && !providerInfo.configured
                  ? `No ${providerInfo.label} key. Add ${providerInfo.envVar} to .env.local and restart the server before running this agent.`
                  : modelHint.text}
              </div>
            </div>

            <div className="tabs" role="tablist">
              <button role="tab" className={tab === "prompt" ? "active" : ""} onClick={() => setTab("prompt")}>
                Prompt{dirty && <span className="dirty-dot" title="Unsaved changes" />}
              </button>
              <button role="tab" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
                History <span className="count">{agent.config.versions.length}</span>
              </button>
              <button role="tab" className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}>
                Test
              </button>
            </div>

            {tab === "prompt" && (
              <div className="tab-body">
                <div className="editor-head">
                  <span className="mono muted small">{agent.config.promptFile}</span>
                  <span className="muted small">
                    {draft.prompt.split("\n").length} lines · {draft.prompt.length.toLocaleString()} chars
                  </span>
                </div>
                <textarea className="editor" spellCheck={false} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
                <p className="muted small" style={{ margin: "6px 0 0" }}>
                  Placeholders: <span className="mono">{"{{TODAY}}"}</span> today&apos;s date · <span className="mono">{"{{HUB_MAP_DOC}}"}</span> the Hub Map reference doc. Effort maps to OpenAI reasoning effort and Gemini thinking level.
                </p>
              </div>
            )}

            {tab === "history" && (
              <div className="tab-body">
                <p className="muted small" style={{ marginTop: 0 }}>
                  Every saved version is kept in <span className="mono">data/prompt-history/{agent.key}/</span>. Edits made to the file outside the app appear as &quot;Edited on disk&quot;.
                </p>
                <div className="history">
                  {[...agent.config.versions].reverse().map((v) => {
                    const current = v.version === agent.config.version;
                    return (
                      <div key={v.version} className={`history-row ${current ? "current" : ""}`}>
                        <div className="history-main">
                          <b>v{v.version}</b>
                          {current && <span className="tag ok">current</span>}
                          <span>{v.note}</span>
                        </div>
                        <div className="muted small">
                          {providerShort(v.provider)} · {v.model} · {v.effort} · {when(v.savedAt)}
                        </div>
                        <div className="history-actions">
                          <button className="link" onClick={() => setViewVersion(viewVersion === v.version ? null : v.version)}>
                            {viewVersion === v.version ? "Hide" : "View"}
                          </button>
                          {!current && (
                            <button className="link" onClick={() => call("POST", { version: v.version }, `Restored v${v.version} to ${agent.config.promptFile}.`)}>
                              Restore
                            </button>
                          )}
                        </div>
                        {viewVersion === v.version && <pre className="history-view">{v.prompt}</pre>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "test" && (
              <div className="tab-body">
                <p className="muted small" style={{ marginTop: 0 }}>
                  Runs this agent once with the settings and prompt above, saved or not. Nothing is saved and no run is affected.
                  {agent.usesWeb ? " Research agents search the web, so a test can take a few minutes." : ""}
                </p>
                <label htmlFor="test-input">Test input</label>
                <textarea id="test-input" rows={8} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={runTest} disabled={testing || !draft.model.trim()}>
                    {testing ? "Running…" : "Run test"}
                  </button>
                  <button className="link" onClick={() => setTestInput(sampleInput(agent))}>Reset sample input</button>
                </div>
                {testOut && <div className="log mono" style={{ maxHeight: 460, marginTop: 12 }}>{testOut}</div>}
              </div>
            )}

            <div className="save-bar">
              <div className="save-status">
                {msg ? (
                  <span className={msg.kind === "err" ? "text-err" : "text-ok"}>{msg.text}</span>
                ) : dirty ? (
                  <span className="text-warn">Unsaved changes</span>
                ) : (
                  <span className="muted">Saved · v{agent.config.version}</span>
                )}
              </div>
              <input className="note-input" placeholder="Version note (optional)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} disabled={!dirty} />
              <button
                type="button"
                onClick={() =>
                  confirm(`Overwrite ${agent.config.promptFile} with the default prompt and reset provider, model and effort? The current text stays in history.`) &&
                  call("POST", { version: "default" }, "Default restored and saved as a new version.")
                }
              >
                Restore default
              </button>
              <button type="button" disabled={!dirty} onClick={() => select(agent, true)}>Discard</button>
              <button
                type="button"
                className="primary"
                disabled={!dirty || !draft.model.trim()}
                onClick={() => call("PUT", { prompt: draft.prompt, provider: draft.provider, model: draft.model, effort: draft.effort, note: draft.note }, `Saved to ${agent.config.promptFile}.`)}
              >
                Save
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function GlobalCard(props: {
  providers: ProviderInfo[];
  models: Record<string, { list: string[]; warning?: string }>;
  efforts: string[];
  global: GlobalConfig;
  agentCount: number;
  onSaved: () => Promise<void>;
  onError: (text: string) => void;
  setProviderDefault: (provider: string, model: string) => Promise<void>;
}) {
  const { providers, models, efforts, global, agentCount } = props;
  const keyed = providers.filter((p) => p.configured);
  // Pre-fill: the saved global provider, else the only keyed provider (or the first keyed one).
  const initialProvider = global.provider && keyed.some((p) => p.id === global.provider) ? global.provider : keyed[0]?.id ?? "";
  const [mode, setMode] = useState(global.mode);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(global.provider === initialProvider ? global.model : "");
  const [effort, setEffort] = useState(global.effort);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Re-sync when the saved global changes (after a save or a page refresh).
  useEffect(() => {
    const p = global.provider && keyed.some((k) => k.id === global.provider) ? global.provider : keyed[0]?.id ?? "";
    setMode(global.mode);
    setProvider(p);
    setModel(global.provider === p ? global.model : "");
    setEffort(global.effort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [global.mode, global.provider, global.model, global.effort, keyed.length]);

  const info = providers.find((p) => p.id === provider);
  const autoModel = info?.defaultModel.model ?? null;
  const effectiveModel = model || autoModel || "";
  const dirty = mode !== global.mode || provider !== global.provider || model !== global.model || effort !== global.effort;
  const list = models[provider]?.list ?? [];

  const summary = (() => {
    if (!keyed.length) return { kind: "warn", text: "No API keys found. Add ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY to .env.local and restart the server." };
    if (global.mode === "all" && global.provider) {
      const p = providers.find((x) => x.id === global.provider);
      if (!p?.configured) return { kind: "warn", text: `The global model uses ${providerShort(global.provider)}, which has no key, so agents use their own settings.` };
      const m = global.model || p.defaultModel.model;
      return { kind: "ok", text: `All ${agentCount} agents run on ${providerShort(global.provider)} · ${m}${global.effort ? ` at ${global.effort} effort` : ", each at its own effort"}.` };
    }
    if (keyed.length === 1) {
      const p = keyed[0];
      return { kind: "ok", text: `Only ${providerShort(p.id)} has a key, so all agents run on ${providerShort(p.id)}. Agents saved with another provider use ${p.defaultModel.model ?? "its default model"}.` };
    }
    return { kind: "muted", text: `Each agent uses its own provider and model. If an agent's provider has no key, it uses the first one that does (Claude, then OpenAI, then Gemini).` };
  })();

  async function save() {
    setBusy(true);
    setNote("");
    const res = await fetch("/api/providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ global: { mode, provider, model, effort } }),
    });
    setBusy(false);
    if (!res.ok) return props.onError((await res.json().catch(() => ({}))).error ?? "Could not save the global setting.");
    setNote(mode === "all" ? "Saved. Every agent now uses this model." : "Saved. Agents use their own settings.");
    await props.onSaved();
  }

  async function applyAll() {
    if (!provider || !effectiveModel) return;
    if (!confirm(`Write ${providerShort(provider)} · ${effectiveModel}${effort ? ` (${effort} effort)` : ""} into all ${agentCount} agents' config.json? Each agent gets a new version, so this can be undone from its history.`)) return;
    setBusy(true);
    setNote("");
    const res = await fetch("/api/providers/apply-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model: effectiveModel, effort }),
    });
    setBusy(false);
    if (!res.ok) return props.onError((await res.json().catch(() => ({}))).error ?? "Could not update the agents.");
    setNote(`Saved to all ${agentCount} agents.`);
    await props.onSaved();
  }

  return (
    <section className="panel global-card">
      <div className="global-head">
        <div>
          <h2>Global model</h2>
          <p className={`small ${summary.kind === "warn" ? "text-warn" : summary.kind === "ok" ? "text-ok" : "muted"}`}>{summary.text}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Global model mode">
          <button role="radio" aria-checked={mode === "auto"} className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")}>Per agent</button>
          <button role="radio" aria-checked={mode === "all"} className={mode === "all" ? "active" : ""} onClick={() => setMode("all")} disabled={!keyed.length}>One model for all agents</button>
        </div>
      </div>

      {keyed.length > 0 && (
        <div className="global-grid">
          <div className="field">
            <label htmlFor="g-provider">Provider</label>
            <select id="g-provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }}>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.configured}>
                  {p.label}{p.configured ? "" : " (no key)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="g-model">Model</label>
            <select id="g-model" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Default{autoModel ? ` (${autoModel})` : ""}</option>
              {[...new Set([...(model ? [model] : []), ...list])].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="g-effort">Effort</label>
            <select id="g-effort" value={effort} onChange={(e) => setEffort(e.target.value)}>
              <option value="">Keep each agent&apos;s effort</option>
              {efforts.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="global-actions">
            <button className="primary" onClick={save} disabled={busy || !dirty || (mode === "all" && !provider)}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={applyAll} disabled={busy || !provider || !effectiveModel} title="Write this provider and model into every agent's config.json">
              Write to every agent
            </button>
          </div>
        </div>
      )}

      {mode === "auto" && keyed.length > 0 && (
        <details className="fallback-defaults">
          <summary>Default model per provider (used when an agent falls back)</summary>
          <div className="global-grid" style={{ marginTop: 10 }}>
            {keyed.map((p) => (
              <div key={p.id} className="field">
                <label htmlFor={`def-${p.id}`}>{providerShort(p.id)}</label>
                <select
                  id={`def-${p.id}`}
                  value={p.defaultModel.source === "configured" ? p.defaultModel.model ?? "" : ""}
                  onChange={(e) => props.setProviderDefault(p.id, e.target.value)}
                >
                  <option value="">Automatic{p.defaultModel.source === "auto" && p.defaultModel.model ? ` (${p.defaultModel.model})` : ""}</option>
                  {[...new Set([...(p.defaultModel.source === "configured" && p.defaultModel.model ? [p.defaultModel.model] : []), ...(models[p.id]?.list ?? [])])].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </details>
      )}
      {(note || dirty) && <p className="small" style={{ margin: "10px 0 0" }}>{note ? <span className="text-ok">{note}</span> : <span className="text-warn">Unsaved global change</span>}</p>}
    </section>
  );
}

type PriceRow = { model: string; price: { input: number; cachedInput: number; output: number }; source: "official" | "custom" };

/** Editable price table (USD per 1M tokens) used for every step's cost estimate. */
function PricingCard({ modelsInUse }: { modelsInUse: string[] }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [asOf, setAsOf] = useState("");
  const [edits, setEdits] = useState<Record<string, { input: string; cachedInput: string; output: string }>>({});
  const [filter, setFilter] = useState("");
  const [newModel, setNewModel] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((d) => { setRows(d.prices); setAsOf(d.asOf); })
      .catch(() => setError("Could not load prices."));
  useEffect(() => { load(); }, []);

  const known = new Set(rows.map((r) => r.model));
  // Models in use first (including any with no price yet), then the rest.
  const missing = modelsInUse.filter((m) => !rows.some((r) => m === r.model || m.startsWith(`${r.model}-`)));
  const ordered = [
    ...missing.map((m) => ({ model: m, price: { input: 0, cachedInput: 0, output: 0 }, source: "none" as const })),
    ...rows.filter((r) => modelsInUse.includes(r.model)),
    ...rows.filter((r) => !modelsInUse.includes(r.model)),
  ].filter((r) => !filter || r.model.includes(filter.trim().toLowerCase()));

  const val = (m: string, f: "input" | "cachedInput" | "output", fallback: number) => edits[m]?.[f] ?? String(fallback);
  async function save(model: string, price: { input: number; cachedInput: number; output: number } | null) {
    setError("");
    const res = await fetch("/api/pricing", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, price }) });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Could not save the price.");
    setRows(d.prices);
    setEdits((e) => { const n = { ...e }; delete n[model]; return n; });
  }

  return (
    <details className="panel pricing-card">
      <summary>
        <b>Model prices</b>
        <span className="muted small"> · USD per 1M tokens, used for cost estimates · official prices as of {asOf}{missing.length ? ` · ${missing.length} model${missing.length > 1 ? "s" : ""} in use without a price` : ""}</span>
      </summary>
      <div className="pricing-tools">
        <input placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <input placeholder="Add a model id" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
        <button disabled={!newModel.trim() || known.has(newModel.trim())} onClick={() => { setEdits((e) => ({ ...e, [newModel.trim()]: { input: "0", cachedInput: "0", output: "0" } })); setFilter(newModel.trim()); setRows((r) => [...r, { model: newModel.trim(), price: { input: 0, cachedInput: 0, output: 0 }, source: "custom" }]); setNewModel(""); }}>
          Add
        </button>
      </div>
      {error && <div className="errors">{error}</div>}
      <div className="table-wrap">
        <table className="pricing-table">
          <thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th><th /></tr></thead>
          <tbody>
            {ordered.map((r) => {
              const e = edits[r.model];
              const changed = !!e;
              const parsed = { input: Number(val(r.model, "input", r.price.input)), cachedInput: Number(val(r.model, "cachedInput", r.price.cachedInput)), output: Number(val(r.model, "output", r.price.output)) };
              return (
                <tr key={r.model} className={modelsInUse.includes(r.model) || r.source === "none" ? "in-use" : ""}>
                  <td>
                    <span className="mono">{r.model}</span>
                    {(modelsInUse.includes(r.model) || r.source === "none") && <span className="tag ok" style={{ marginLeft: 6 }}>in use</span>}
                    {r.source === "custom" && <span className="tag custom" style={{ marginLeft: 6 }}>custom</span>}
                    {r.source === "none" && <span className="tag warn" style={{ marginLeft: 6 }}>no price</span>}
                  </td>
                  {(["input", "cachedInput", "output"] as const).map((f) => (
                    <td key={f}>
                      <input className="price-input" type="number" min="0" step="0.001" value={val(r.model, f, r.price[f])}
                        onChange={(ev) => setEdits((x) => ({ ...x, [r.model]: { input: val(r.model, "input", r.price.input), cachedInput: val(r.model, "cachedInput", r.price.cachedInput), output: val(r.model, "output", r.price.output), [f]: ev.target.value } }))} />
                    </td>
                  ))}
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      {changed && <button className="link" onClick={() => save(r.model, parsed)}>Save</button>}
                      {r.source === "custom" && !changed && <button className="link" onClick={() => save(r.model, null)} title="Remove the custom price">Reset</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Web search adds $10 per 1,000 calls on Claude and OpenAI and $14 per 1,000 on Gemini (free monthly allowances not subtracted). Costs are estimates, not your bill.
      </p>
    </details>
  );
}

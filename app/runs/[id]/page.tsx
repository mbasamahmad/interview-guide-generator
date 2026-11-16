"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; webSearches: number; costUsd: number; unpricedCalls?: number };
type Step = {
  key: string; label: string; group: string; agent?: string; status: string;
  startedAt?: string; endedAt?: string; error?: string; warnings?: string[]; promptVersion?: number; provider?: string; model?: string; fallbackFrom?: string; global?: boolean; usage?: Usage;
};
type Page = { path: string; kind: string; pageType: string; title: string; url: string; inputs?: string[] };
type DiscoveredRole = {
  slug: string; title: string; inTaxonomy: boolean; evidenceStrength: string; openPostings: number;
  summary: string; languages: string[]; levels: string[];
};
type DiscoveredType = { type: string; label: string; rounds: string[]; roles: string[]; confidence: string[] };
type Discovery = {
  roles: DiscoveredRole[]; interviewTypes: DiscoveredType[]; hasOtherRounds: boolean; loopSummary: string;
  codingTopics: { topic: string; patterns: string[]; confidence: string }[]; codingQuestionTopics: number; codingQuestions: number;
};
type RunView = {
  id: string; status: string; active: boolean; error?: string; createdAt: string;
  input: {
    company: string;
    companySlug: string;
    sheet?: { keyword: string; svLabel: string; url: string; secondaryKeywords: string[]; h1: string; metaTitle: string; metaDescription: string };
  };
  selection: { roles: string[]; interviewTypes: string[] } | null;
  previousSelection: { roles: string[]; interviewTypes: string[] } | null;
  discovery: Discovery;
  steps: Step[]; pages: Page[]; files: { path: string; bytes: number }[];
  validation: { errors: { file: string; problem: string }[]; warnings: number; linksChecked: number; brokenLinksRemoved: number; unverifiedLinks: number } | null;
  log: string[]; usage: Usage;
  report: Report;
};
type Report = {
  company: { name: string; oneLiner: string; timeline: string };
  roles: { title: string; slug: string; oneLiner: string; evidence: string; openPostings: number; interviewTypes: string[] }[];
  excludedRoles: string[];
  interviewTypes: { type: string; label: string; oneLiner: string; rounds: string[]; roles: string[] }[];
  codingQuestions: { title: string; difficulty: string; topic: string; pattern: string; evidence: string }[];
  ready: { company: boolean; role: boolean; interview: boolean; coding: boolean };
};

const STAGES = ["write", "interactive", "seo", "qa"];

function duration(s: Step) {
  if (!s.startedAt) return "";
  const ms = (s.endedAt ? new Date(s.endedAt).getTime() : Date.now()) - new Date(s.startedAt).getTime();
  return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
const money = (n: number) => `$${n.toFixed(2)}`;
const stepCost = (u: Usage) => (u.unpricedCalls ? "not priced" : money(u.costUsd));
const PROVIDER_SHORT: Record<string, string> = { anthropic: "Claude", openai: "OpenAI", gemini: "Gemini" };
const modelLabel = (s: Step) =>
  s.model
    ? `${PROVIDER_SHORT[s.provider ?? "anthropic"] ?? s.provider} · ${s.model} · v${s.promptVersion}${s.global ? " (global)" : s.fallbackFrom ? ` (no ${PROVIDER_SHORT[s.fallbackFrom] ?? s.fallbackFrom} key)` : ""}`
    : "";
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));


export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [rerun, setRerun] = useState<Part[] | null>(null); // research re-run panel: parts preselected

  const [offline, setOffline] = useState(false);
  const runRef = useRef<RunView | null>(null);
  const offlineRef = useRef(false);

  // Fetch the run. Network errors (e.g. the dev server restarting) show "Reconnecting…" instead of crashing.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      offlineRef.current = false;
      setOffline(false);
      if (res.status === 404) return setNotFound(true);
      if (res.ok) {
        const data = (await res.json()) as RunView;
        runRef.current = data;
        setRun(data);
      }
    } catch {
      offlineRef.current = true;
      setOffline(true);
    }
  }, [id]);

  // One interval for the page's lifetime: poll every 2.5 s while the run is working or the server is unreachable.
  useEffect(() => {
    load();
    const t = setInterval(() => {
      const r = runRef.current;
      if (offlineRef.current || !r || r.active || r.status === "running" || r.status === "queued") load();
    }, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function retry(stepKey?: string) {
    setActionError("");
    try {
      const res = await fetch(`/api/runs/${id}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stepKey }) });
      if (!res.ok) setActionError((await res.json().catch(() => ({}))).error ?? "Retry failed.");
    } catch {
      setActionError("Could not reach the server. Check that it is running, then try again.");
    }
    setTimeout(load, 300);
  }

  // Open a generated file in the formatted reader.
  function showFile(path: string) {
    router.push(`/runs/${id}/read?path=${encodeURIComponent(path)}`);
  }

  const byKey = useMemo(() => Object.fromEntries((run?.steps ?? []).map((s) => [s.key, s])), [run]);
  const fileFor = useCallback((pagePath: string) => run?.files.find((f) => f.path.endsWith(`/${pagePath}`))?.path, [run]);

  if (notFound) return <p>Run not found.</p>;
  if (!run) return <p className="muted">Loading…</p>;

  const research = run.steps.filter((s) => s.group === "Research" || s.group === "Planning");
  const finals = run.steps.filter((s) => s.group === "Finalize");
  const failedCount = run.steps.filter((s) => s.status === "failed").length;
  const pageSteps = run.steps.filter((s) => s.group.startsWith("page:"));
  const pagesDone = run.pages.filter((p) => STAGES.every((st) => ["done", "skipped"].includes(byKey[`page:${p.path}:${st}`]?.status))).length;
  const running = run.active || run.status === "running" || run.status === "queued";

  const StepRow = ({ s }: { s: Step }) => (
    <>
      <tr>
        <td>
          <button className="link" onClick={() => setOpen(open === s.key ? null : s.key)}>{s.label}</button>
          {s.warnings?.length ? <span className="badge s-pending" style={{ marginLeft: 6 }}>{s.warnings.length} note{s.warnings.length > 1 ? "s" : ""}</span> : null}
        </td>
        <td><span className={`badge s-${s.status}`}>{s.status}</span></td>
        <td className="muted small">{duration(s)}</td>
        <td className="muted small">{modelLabel(s)}</td>
        <td className="muted small">{s.usage ? stepCost(s.usage) : ""}</td>
        <td>
          {s.status === "failed" && !running && <button onClick={() => retry(s.key)}>Retry</button>}
          {s.key.startsWith("research:") && (s.status === "done" || s.status === "skipped") && !running && (
            <button className="sm" onClick={() => setRerun([s.key.slice("research:".length) as Part])}>Re-run</button>
          )}
        </td>
      </tr>
      {open === s.key && (s.error || s.warnings?.length || s.usage) && (
        <tr>
          <td colSpan={6}>
            {s.error && <div className="detail err">{s.error}</div>}
            {s.warnings?.map((w, i) => <div className="detail" key={i}>{w}</div>)}
            {s.usage && (
              <div className="muted small" style={{ marginTop: 6 }}>
                {k(s.usage.inputTokens)} in · {k(s.usage.outputTokens)} out · {k(s.usage.cacheReadTokens)} cached · {s.usage.webSearches} searches
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <h1>{run.input.company}</h1>
          <div className="muted">
            Started {new Date(run.createdAt).toLocaleString()}
            {run.selection && ` · ${run.selection.roles.length} role${run.selection.roles.length === 1 ? "" : "s"}, ${run.selection.interviewTypes.length} interview type${run.selection.interviewTypes.length === 1 ? "" : "s"} · all levels`}
          </div>
        </div>
        <div className="row">
          <span className={`badge s-${run.status}`} style={{ fontSize: 14 }}>{run.status}</span>
          {failedCount > 0 && !running && <button onClick={() => retry()}>Retry {failedCount} failed</button>}
          {run.files.length > 0 && (
            <button onClick={() => router.push(`/runs/${id}/read`)}>Open guide</button>
          )}
          <a className={`btn primary ${run.status === "done" ? "" : "disabled"}`} href={`/api/runs/${id}/zip`}>Download ZIP</a>
        </div>
      </div>

      {offline && (
        <div className="notice">Reconnecting to the server… If the server restarted, the run resumes by itself once it is back.</div>
      )}
      {run.error && <div className="errors" style={{ marginTop: 0 }}>{run.error}</div>}
      {actionError && <div className="errors" style={{ marginTop: 0 }}>{actionError}</div>}

      {run.input.sheet && (
        <details className="panel plan-panel">
          <summary>
            <b>Keyword plan from the company sheet</b>
            <span className="muted small">
              {" "}· {run.input.sheet.keyword}
              {run.input.sheet.svLabel && ` · ${run.input.sheet.svLabel} searches/month`} · {run.input.sheet.secondaryKeywords.length} related searches · used by the research, writer and SEO agents
            </span>
          </summary>
          <table className="plan-table">
            <tbody>
              <tr><th>Keyword</th><td>{run.input.sheet.keyword || <span className="muted">—</span>}</td></tr>
              <tr><th>SV</th><td>{run.input.sheet.svLabel || <span className="muted">—</span>}</td></tr>
              <tr><th>Slug</th><td className="mono">{run.input.sheet.url || <span className="muted">—</span>}</td></tr>
              <tr>
                <th>Secondary keywords</th>
                <td>
                  <div className="meta-keywords">
                    {run.input.sheet.secondaryKeywords.length ? run.input.sheet.secondaryKeywords.map((k) => <span key={k} className="chip">{k}</span>) : <span className="muted">—</span>}
                  </div>
                </td>
              </tr>
              <tr><th>H1</th><td>{run.input.sheet.h1 || <span className="muted">Not set in the sheet (the SEO agent writes it)</span>}</td></tr>
              <tr><th>Meta title</th><td>{run.input.sheet.metaTitle || <span className="muted">Not set in the sheet (the SEO agent writes it)</span>}</td></tr>
              <tr><th>Meta description</th><td>{run.input.sheet.metaDescription || <span className="muted">Not set in the sheet (the SEO agent writes it)</span>}</td></tr>
            </tbody>
          </table>
        </details>
      )}

      <div className="panel stats">
        <div className="stat"><b>{pagesDone}/{run.pages.length || "–"}</b><span>pages complete</span></div>
        <div className="stat"><b>{pageSteps.filter((s) => s.status === "running").length + research.filter((s) => s.status === "running").length}</b><span>agents running</span></div>
        <div className="stat"><b>{money(run.usage.costUsd)}</b><span>estimated cost{run.usage.unpricedCalls ? ` (+${run.usage.unpricedCalls} OpenAI/Gemini calls not priced)` : ""}</span></div>
        <div className="stat"><b>{k(run.usage.inputTokens + run.usage.cacheReadTokens)} / {k(run.usage.outputTokens)}</b><span>tokens in / out</span></div>
        <div className="stat"><b>{run.usage.webSearches}</b><span>web searches</span></div>
      </div>

      {(run.report.ready.company || run.report.ready.role) && (
        <ReportPanel runId={id} report={run.report} defaultOpen={!run.selection} />
      )}

      {run.status === "awaiting-selection" && !run.active && (
        <SelectionPanel runId={id} discovery={run.discovery} previous={run.previousSelection} onDone={load} />
      )}

      {run.selection && run.discovery.roles.length > 0 && (
        <section className="panel discovered-summary">
          <div className="small">
            <b>Covering:</b>{" "}
            {run.discovery.roles.filter((r) => run.selection!.roles.includes(r.slug)).map((r) => (
              <span key={r.slug} className="chip">{r.title}</span>
            ))}
            {run.selection.interviewTypes.map((t) => (
              <span key={t} className="chip chip-alt">{run.discovery.interviewTypes.find((x) => x.type === t)?.label ?? t}</span>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Research and planning</h2>
          <button onClick={() => setRerun(rerun ? null : [])} disabled={running} title={running ? "Available when the run is not working" : "Research chosen parts again"}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Re-run research
          </button>
        </div>
        {rerun && !running && (
          <RerunPanel
            runId={id}
            initial={rerun}
            steps={run.steps}
            pages={run.pages}
            onClose={() => setRerun(null)}
            onDone={() => {
              setRerun(null);
              setTimeout(load, 300);
            }}
          />
        )}
        <div className="panel table-wrap" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Agent</th><th>Status</th><th>Time</th><th>Provider · model · prompt</th><th>Cost</th><th /></tr></thead>
            <tbody>{research.map((s) => <StepRow key={s.key} s={s} />)}</tbody>
          </table>
        </div>
      </section>

      {run.pages.length > 0 && (
        <section>
          <h2>Pages</h2>
          <p className="muted small" style={{ marginTop: -4 }}>Each page goes through write → interactive → SEO → QA. Click a stage for details or to re-run it.</p>
          <div className="panel table-wrap" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Page</th><th>Stages</th><th /></tr></thead>
              <tbody>
                {run.pages.map((p) => {
                  const steps = STAGES.map((st) => byKey[`page:${p.path}:${st}`]).filter(Boolean);
                  const openStep = steps.find((s) => s.key === open);
                  const file = fileFor(p.path);
                  return (
                    <PageRow key={p.path}>
                      <tr>
                        <td>
                          <div className="mono">{p.path}</div>
                          <div className="muted small">{p.kind === "landing" ? `Landing · ${p.url}` : "Study guide"}</div>
                        </td>
                        <td>
                          <div className="pills">
                            {steps.map((s) => (
                              <button key={s.key} className={`pill s-${s.status}`} title={s.error ?? s.status} onClick={() => setOpen(open === s.key ? null : s.key)}>
                                {s.key.split(":").pop()}{s.warnings?.length ? " •" : ""}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>
                          {file && (
                            <div className="row">
                              <button className="link" onClick={() => showFile(file)}>Preview</button>
                              <a href={`/api/runs/${id}/file?path=${encodeURIComponent(file)}`}>Download</a>
                            </div>
                          )}
                        </td>
                      </tr>
                      {openStep && (
                        <tr>
                          <td colSpan={3}>
                            <div className="spread">
                              <div className="small">
                                <b>{openStep.label}</b> · <span className={`badge s-${openStep.status}`}>{openStep.status}</span> {duration(openStep)}
                                {openStep.model && <span className="muted"> · {modelLabel(openStep)}</span>}
                                {openStep.usage && <span className="muted"> · {stepCost(openStep.usage)}</span>}
                              </div>
                              {!running && ["done", "failed", "skipped"].includes(openStep.status) && (
                                <button onClick={() => retry(openStep.key)}>{openStep.status === "failed" ? "Retry" : "Re-run"} from this stage</button>
                              )}
                            </div>
                            {openStep.error && <div className="detail err">{openStep.error}</div>}
                            {openStep.warnings?.map((w, i) => <div className="detail" key={i}>{w}</div>)}
                          </td>
                        </tr>
                      )}
                    </PageRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {finals.length > 0 && (
        <section>
          <h2>Finalize</h2>
          <div className="panel table-wrap" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Step</th><th>Status</th><th>Time</th><th /><th /><th /></tr></thead>
              <tbody>{finals.map((s) => <StepRow key={s.key} s={s} />)}</tbody>
            </table>
          </div>
          {run.validation && run.validation.errors.length > 0 && (
            <div className="errors">
              <b>Validation errors: re-run these pages, then retry validation.</b>
              {run.validation.errors.map((e, i) => (
                <div key={i} className="small mono">{e.file.split("/").slice(1).join("/")}: {e.problem}</div>
              ))}
            </div>
          )}
        </section>
      )}

      {run.files.length > 0 && (
        <section>
          <h2>Files ({run.files.length})</h2>
          <div className="panel table-wrap" style={{ padding: 0 }}>
            <table>
              <tbody>
                {run.files.map((f) => (
                  <tr key={f.path}>
                    <td className="mono">{f.path.split("/").slice(1).join("/")}</td>
                    <td className="muted small">{(f.bytes / 1024).toFixed(1)} KB</td>
                    <td>
                      <div className="row">
                        <button className="link" onClick={() => showFile(f.path)}>Preview</button>
                        <a href={`/api/runs/${id}/file?path=${encodeURIComponent(f.path)}`}>Download</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2>Log</h2>
        <div className="log mono">{run.log.length ? run.log.join("\n") : "No events yet."}</div>
      </section>
    </div>
  );
}

function PageRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const EVIDENCE_LABEL: Record<string, string> = {
  "many-postings": "Many open postings",
  "some-postings": "Some open postings",
  mentioned: "Listed, no open posting found",
  inferred: "Inferred",
};

function SelectionPanel({ runId, discovery, previous, onDone }: { runId: string; discovery: Discovery; previous: { roles: string[]; interviewTypes: string[] } | null; onDone: () => void }) {
  // After re-running research: the last choice, where it still exists.
  const prevRoles = previous?.roles.filter((s) => discovery.roles.some((r) => r.slug === s)) ?? [];
  const prevTypes = previous?.interviewTypes.filter((t) => discovery.interviewTypes.some((x) => x.type === t)) ?? [];
  // Otherwise: the strongest-evidence roles (up to 3) and every interview type found.
  const [roles, setRoles] = useState<string[]>(() =>
    prevRoles.length ? prevRoles : discovery.roles.filter((r) => r.evidenceStrength === "many-postings" || r.evidenceStrength === "some-postings").slice(0, 3).map((r) => r.slug).concat(
      discovery.roles.some((r) => r.evidenceStrength === "many-postings" || r.evidenceStrength === "some-postings") ? [] : discovery.roles.slice(0, 1).map((r) => r.slug),
    ),
  );
  const [types, setTypes] = useState<string[]>(() => (previous && prevRoles.length ? prevTypes : discovery.interviewTypes.map((t) => t.type)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const roleTitle = (slug: string) => discovery.roles.find((r) => r.slug === slug)?.title ?? slug;

  // Mirrors planPages(): company guide, coding questions, one page per role and per interview type.
  const coding = discovery.codingQuestions > 0;
  const total = 1 + (coding ? 1 : 0) + roles.length + types.length;

  async function confirm() {
    setError("");
    if (!roles.length) return setError("Choose at least one role.");
    setBusy(true);
    const res = await fetch(`/api/runs/${runId}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles, interviewTypes: types }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not continue the run.");
    onDone();
  }

  return (
    <section className="panel select-panel">
      <div className="spread">
        <div>
          <h2 style={{ marginTop: 0 }}>Choose what to cover</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Research found {discovery.roles.length} role{discovery.roles.length === 1 ? "" : "s"} and {discovery.interviewTypes.length} interview type{discovery.interviewTypes.length === 1 ? "" : "s"}.
            Each page covers every level, from entry to staff.
          </p>
        </div>
      </div>
      {discovery.loopSummary && <p className="small" style={{ marginBottom: 0 }}>{discovery.loopSummary}</p>}

      <h3 className="select-heading">
        Roles <span className="muted small">({roles.length} selected)</span>
        <span className="row small" style={{ gap: 12 }}>
          <button className="link" onClick={() => setRoles(discovery.roles.map((r) => r.slug))}>All</button>
          <button className="link" onClick={() => setRoles([])}>None</button>
        </span>
      </h3>
      <div className="option-grid">
        {discovery.roles.map((r) => {
          const on = roles.includes(r.slug);
          return (
            <label key={r.slug} className={`option ${on ? "on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(roles, setRoles, r.slug)} />
              <div>
                <div className="option-title">{r.title}</div>
                <div className="row small" style={{ gap: 6, margin: "4px 0" }}>
                  <span className={`badge ev-${r.evidenceStrength}`}>{EVIDENCE_LABEL[r.evidenceStrength] ?? r.evidenceStrength}{r.openPostings ? ` · ~${r.openPostings}` : ""}</span>
                  {!r.inTaxonomy && <span className="badge s-pending" title="Not one of the 10 taxonomy roles, so its URL is not a standard Hub Map URL">custom URL</span>}
                </div>
                <div className="muted small">{r.summary}</div>
                {r.languages.length > 0 && <div className="small" style={{ marginTop: 4 }}>{r.languages.map((l) => <span key={l} className="chip">{l}</span>)}</div>}
                {(() => {
                  const faced = discovery.interviewTypes.filter((t) => t.roles.length === 0 || t.roles.includes("all") || t.roles.includes(r.slug));
                  return (
                    <div className="role-types small">
                      <span className="role-types-label">Interview types</span>
                      {faced.length ? (
                        faced.map((t) => (
                          <span key={t.type} className="chip chip-alt" title={t.rounds.join(", ")}>{t.label}</span>
                        ))
                      ) : (
                        <span className="muted">None found for this role</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </label>
          );
        })}
      </div>

      <h3 className="select-heading">
        Interview types <span className="muted small">({types.length} selected)</span>
        <span className="row small" style={{ gap: 12 }}>
          <button className="link" onClick={() => setTypes(discovery.interviewTypes.map((t) => t.type))}>All</button>
          <button className="link" onClick={() => setTypes([])}>None</button>
        </span>
      </h3>
      {discovery.interviewTypes.length === 0 ? (
        <p className="muted small">No standard interview rounds were found. The company and role pages will still describe the loop.</p>
      ) : (
        <div className="option-grid">
          {discovery.interviewTypes.map((t) => {
            const on = types.includes(t.type);
            return (
              <label key={t.type} className={`option ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(types, setTypes, t.type)} />
                <div>
                  <div className="option-title">{t.label}</div>
                  <div className="muted small">Rounds: {t.rounds.join(", ")}</div>
                  <div className="muted small">
                    For: {t.roles.includes("all") || t.roles.length === 0 ? "all roles" : t.roles.map(roleTitle).join(", ")} · {t.confidence.join(" / ")}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {discovery.codingTopics.length > 0 && (
        <div className="small" style={{ marginTop: 14 }}>
          <b>Coding focus found:</b>{" "}
          {discovery.codingTopics.map((c) => <span key={c.topic} className="chip chip-alt" title={c.patterns.join(", ")}>{c.topic.replace(/-/g, " ")}</span>)}
          <span className="muted"> · {discovery.codingQuestions} questions with solutions</span>
        </div>
      )}

      <div className="select-footer">
        <div>
          <b>{total} pages</b>
          <span className="muted small"> · {roles.length} role{roles.length === 1 ? "" : "s"}, {types.length} interview type{types.length === 1 ? "" : "s"} · about {total * 4} agent calls</span>
        </div>
        <button className="primary" onClick={confirm} disabled={busy || !roles.length}>{busy ? "Starting…" : `Generate ${total} pages`}</button>
      </div>
      {error && <div className="errors">{error}</div>}
    </section>
  );
}

/** What research found: the company, its CS roles and interview types (one line each), and the coding questions. */
function ReportPanel({ runId, report, defaultOpen }: { runId: string; report: Report; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pending = (label: string) => <p className="muted small">Researching {label}…</p>;
  const diffOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const counts = report.codingQuestions.reduce<Record<string, number>>((m, q) => ((m[q.difficulty] = (m[q.difficulty] ?? 0) + 1), m), {});
  return (
    <section className="panel report">
      <div className="report-head">
        <button type="button" className="report-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>
            <b>Research report</b>
            <span className="muted small">
              {" "}· {report.roles.length} roles · {report.interviewTypes.length} interview types · {report.codingQuestions.length} coding questions · computer science only
            </span>
          </span>
        </button>
        <a className="btn sm" href={`/api/runs/${runId}/report`}>Download report</a>
      </div>

      {open && (
        <div className="report-body">
          <div className="report-company">
            <span className="report-label">Company</span>
            <h3>{report.company.name}</h3>
            {report.ready.company ? <p>{report.company.oneLiner || <span className="muted">No description found.</span>}</p> : pending("the company")}
            {report.company.timeline && <p className="muted small">Typical interview timeline: {report.company.timeline}</p>}
          </div>

          <div className="report-section">
            <span className="report-label">Roles <span className="count">{report.roles.length}</span></span>
            {!report.ready.role ? pending("roles") : report.roles.length === 0 ? <p className="muted small">No computer science roles found.</p> : (
              <ul className="report-list">
                {report.roles.map((r) => (
                  <li key={r.slug}>
                    <div className="report-item-head">
                      <b>{r.title}</b>
                      <span className="tag">{r.evidence}{r.openPostings ? ` · ~${r.openPostings}` : ""}</span>
                    </div>
                    <span className="muted small">{r.oneLiner}</span>
                    {report.ready.interview && (
                      <span className="report-roles">
                        Interviews: {r.interviewTypes?.length ? r.interviewTypes.join(", ") : "none found for this role"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {report.excludedRoles.length > 0 && (
              <p className="muted small report-excluded">Not covered (non-technical): {report.excludedRoles.join(", ")}</p>
            )}
          </div>

          <div className="report-section">
            <span className="report-label">Interview types <span className="count">{report.interviewTypes.length}</span></span>
            {!report.ready.interview ? pending("the interview loop") : report.interviewTypes.length === 0 ? <p className="muted small">No interview rounds found.</p> : (
              <ul className="report-list">
                {report.interviewTypes.map((t) => (
                  <li key={t.type}>
                    <b>{t.label}</b>
                    <span className="muted small">{t.oneLiner}</span>
                    <span className="report-roles">
                      {t.roles.length > 3 ? `${t.roles.slice(0, 3).join(", ")} +${t.roles.length - 3} more` : t.roles.join(", ") || "All roles"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="report-section">
            <span className="report-label">
              Coding questions <span className="count">{report.codingQuestions.length}</span>
              {report.codingQuestions.length > 0 && (
                <span className="muted small" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  {" "}{["easy", "medium", "hard"].filter((d) => counts[d]).map((d) => `${counts[d]} ${d}`).join(" · ")}
                </span>
              )}
            </span>
            {!report.ready.coding ? pending("coding questions") : report.codingQuestions.length === 0 ? <p className="muted small">No coding questions found.</p> : (
              <ol className="report-questions">
                {[...report.codingQuestions]
                  .map((q, i) => ({ ...q, i }))
                  .sort((a, b) => a.topic.localeCompare(b.topic) || diffOrder[a.difficulty] - diffOrder[b.difficulty])
                  .map((q) => (
                    <li key={q.i} title={`${q.topic} · ${q.pattern} · ${q.evidence}`}>
                      <span className={`diff diff-${q.difficulty}`}>{q.difficulty}</span>
                      <span className="q-title">{q.title}</span>
                      <span className="muted small q-topic">{q.topic}</span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type Part = "company" | "role" | "interview" | "coding";
const PARTS: { key: Part; label: string; text: string }[] = [
  { key: "company", label: "Company research", text: "Overview, products, tech stack, culture" },
  { key: "role", label: "Role discovery", text: "Computer science roles the company hires for" },
  { key: "interview", label: "Interview loop", text: "Rounds, interview types, process and timeline" },
  { key: "coding", label: "Coding questions", text: "Topics the company emphasizes and the question set" },
];
// Page inputs that come from each research part (mirrors RESEARCH_INPUTS in lib/pipeline.ts).
const PART_INPUTS: Record<Part, string[]> = {
  company: ["company"],
  role: ["role", "roleIndex"],
  interview: ["interview"],
  coding: ["coding", "codingIndex", "codingTopics"],
};

/** Choose research parts to re-run, and whether the pages that use them are rewritten. */
function RerunPanel({ runId, initial, steps, pages, onClose, onDone }: {
  runId: string; initial: Part[]; steps: Step[]; pages: Page[]; onClose: () => void; onDone: () => void;
}) {
  const [picked, setPicked] = useState<Part[]>(initial);
  const [rewrite, setRewrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setPicked(initial), [initial]);

  // Interview and coding research use the role list, so they re-run with it.
  const forced: Part[] = picked.includes("role") ? ["interview", "coding"] : [];
  const all = PARTS.map((p) => p.key).filter((k) => picked.includes(k) || forced.includes(k));
  const stepOf = (k: Part) => steps.find((s) => s.key === `research:${k}`);
  const lastCost = all.reduce((n, k) => n + (stepOf(k)?.usage?.costUsd ?? 0), 0);
  const inputs = new Set(all.flatMap((k) => PART_INPUTS[k]));
  const affected = pages.filter((p) => p.inputs?.some((i) => inputs.has(i)));
  const hasPages = pages.length > 0;

  async function go() {
    if (!all.length) return setError("Choose at least one part.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/runs/${runId}/rerun-research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: all, rewritePages: hasPages && rewrite }),
      });
      if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not start the re-run.");
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel rerun-panel">
      <div className="rerun-head">
        <div>
          <b>Re-run research</b>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Pick the parts to research again. Everything else is kept.</p>
        </div>
        <button className="link" onClick={onClose}>Close</button>
      </div>

      <div className="rerun-parts">
        {PARTS.map((p) => {
          const isForced = forced.includes(p.key) && !picked.includes(p.key);
          const on = picked.includes(p.key) || isForced;
          const st = stepOf(p.key);
          return (
            <label key={p.key} className={`option ${on ? "on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={isForced}
                onChange={() => setPicked((cur) => (cur.includes(p.key) ? cur.filter((x) => x !== p.key) : [...cur, p.key]))}
              />
              <span>
                <b>{p.label}</b>
                <span className="muted small" style={{ display: "block" }}>{p.text}</span>
                <span className={`small ${isForced ? "rerun-forced" : "muted"}`} style={{ display: "block" }}>
                  {isForced
                    ? "Included: it uses the role list"
                    : st?.usage
                      ? `Last run ${st.usage.costUsd ? `$${st.usage.costUsd.toFixed(2)}` : ""}${st.endedAt ? ` · ${new Date(st.endedAt).toLocaleDateString()}` : ""}`
                      : st?.status === "skipped" ? "Agent was disabled" : "Not run yet"}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {hasPages && (
        <div className="rerun-mode">
          <label className={`option ${!rewrite ? "on" : ""}`}>
            <input type="radio" name="rerun-mode" checked={!rewrite} onChange={() => setRewrite(false)} />
            <span>
              <b>Update research only</b>
              <span className="muted small" style={{ display: "block" }}>The research report and the ZIP are rebuilt. Written pages stay as they are.</span>
            </span>
          </label>
          <label className={`option ${rewrite ? "on" : ""}`}>
            <input type="radio" name="rerun-mode" checked={rewrite} onChange={() => setRewrite(true)} />
            <span>
              <b>Also rewrite pages that use it</b>
              <span className="muted small" style={{ display: "block" }}>
                {all.length ? `${affected.length} of ${pages.length} pages are rewritten (write, interactive, SEO, QA).` : "Pages that use the chosen research are rewritten."}
                {all.includes("role") && " You choose roles and interview types again first; your last choice is preselected."}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="rerun-foot">
        <span className="muted small">
          {all.length
            ? `Re-runs ${all.length} research agent${all.length > 1 ? "s" : ""}${lastCost ? `; last time they cost about $${lastCost.toFixed(2)}` : ""}${hasPages && rewrite ? `, plus ${affected.length} page rewrites` : ""}.`
            : "Nothing selected yet."}
        </span>
        {error && <span className="rerun-error small">{error}</span>}
        <button className="primary" onClick={go} disabled={busy || !all.length}>
          {busy ? "Starting…" : `Re-run ${all.length ? `${all.length} part${all.length === 1 ? "" : "s"}` : ""}`}
        </button>
      </div>
    </div>
  );
}

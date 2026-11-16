"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CompanyList } from "./components/SheetSettings";

type RunSummary = { id: string; createdAt: string; status: string; input: { company: string; companySlug?: string } };
type Company = { name: string; slug: string; keyword: string; searchVolume: number | null; svLabel: string };


const STEPS = [
  { n: "1", title: "Discover", text: "Agents research the company, the roles it hires for, its interview loop, and the coding topics it asks about." },
  { n: "2", title: "Choose", text: "You review what was found and pick the roles and interview types to cover." },
  { n: "3", title: "Write", text: "Each page is written, made interactive, SEO-optimized and proofread. All levels, entry to staff." },
  { n: "4", title: "Download", text: "Landing pages, a study guide, sources and SEO metadata as Markdown in one ZIP." },
];

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  "awaiting-selection": "Needs your choice",
  done: "Complete",
  failed: "Stopped",
};

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const letterOf = (name: string) => (/^[a-z]/i.test(name) ? name[0].toUpperCase() : "#");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const matches = (c: Company, q: string) => !q || norm(c.name).includes(norm(q)) || c.slug.includes(norm(q)) || c.name.toLowerCase().includes(q.toLowerCase());

function SvChip({ c }: { c: Company }) {
  if (!c.svLabel) return null;
  return <span className="sv-chip" title={`Monthly search volume for "${c.keyword}"`}>{c.svLabel}</span>;
}

export default function Home() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // slug (or "free") of the run being started
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [list, setList] = useState<CompanyList | null>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "none" | "active" | "done">("all");
  const [sort, setSort] = useState<"name" | "sv">("name");
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => setRuns([]));
    fetch("/api/companies")
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList({ companies: [], source: "none", error: "Could not load the company list." }));
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const companies = list?.companies ?? [];
  const suggestions = useMemo(() => companies.filter((c) => matches(c, company.trim())), [companies, company]);
  const exact = companies.find((c) => c.name.toLowerCase() === company.trim().toLowerCase());

  // Latest run per company slug (runs are newest first).
  const latestRun = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of runs ?? []) {
      const key = r.input.companySlug ?? norm(r.input.company);
      if (!m.has(key)) m.set(key, r);
    }
    return m;
  }, [runs]);
  const runFor = (c: Company) => latestRun.get(c.slug);

  useEffect(() => setHi(0), [company]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  async function start(name: string, slug?: string) {
    setError("");
    if (!name.trim()) return setError("Enter or pick a company.");
    setBusy(slug ?? "free");
    try {
      const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: name.trim(), slug }) });
      const data = await res.json();
      if (!res.ok) return setError((data.errors ?? [data.error ?? "Could not start the run."]).join(" "));
      router.push(`/runs/${data.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (open && suggestions[hi] && company.trim() && !exact) {
      const c = suggestions[hi];
      setCompany(c.name);
      setOpen(false);
      return;
    }
    void start(exact?.name ?? company, exact?.slug);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") setOpen(false);
  }


  // ---- Directory: filter, status, sort.
  const statusOf = (c: Company): "done" | "active" | "none" => {
    const r = runFor(c);
    if (!r) return "none";
    return r.status === "done" ? "done" : "active";
  };
  const counts = useMemo(() => {
    const n = { all: companies.length, done: 0, active: 0, none: 0 };
    for (const c of companies) n[statusOf(c)]++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, latestRun]);
  const rows = useMemo(() => {
    const q = filter.trim();
    const out = companies.filter((c) => matches(c, q) && (statusFilter === "all" || statusOf(c) === statusFilter));
    if (sort === "sv") out.sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.name.localeCompare(b.name));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, filter, statusFilter, sort, latestRun]);
  const maxSv = useMemo(() => Math.max(1, ...companies.map((c) => c.searchVolume ?? 0)), [companies]);
  const letters = useMemo(() => [...new Set(companies.map((c) => letterOf(c.name)))], [companies]);
  const shownLetters = new Set(sort === "name" ? rows.map((c) => letterOf(c.name)) : []);

  // Dropdown rows with letter headers between groups.
  let lastLetter = "";
  let lastDirLetter = "";

  return (
    <div className="home">
      <section className="hero">
        <span className="hero-eyebrow">Interview guide generator</span>
        <h1>Company interview guides, researched for you</h1>
        <p className="muted">Pick a company from your sheet, or type any company. The agents find its roles, interview loop and coding focus, then write the guide.</p>
        <form className="search" onSubmit={submit}>
          <div className="combo" ref={boxRef}>
            <svg className="search-icon" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input
              aria-label="Company name"
              role="combobox"
              aria-expanded={open}
              aria-controls="company-options"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKey}
              placeholder={companies.length ? `Search ${companies.length} companies…` : "Company name, e.g. Stripe, Anthropic, Netflix"}
              maxLength={80}
              autoComplete="off"
            />
            <button type="button" className="combo-toggle" aria-label="Show all companies" onClick={() => setOpen((o) => !o)}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {open && companies.length > 0 && (
              <div className="combo-menu" id="company-options" role="listbox" ref={listRef}>
                <div className="combo-head muted small">
                  <span>{company.trim() ? `${suggestions.length} of ${companies.length} companies` : `${companies.length} companies · A–Z`}</span>
                  <span className="kbd-hint">↑↓ to move · Enter to pick · Esc to close</span>
                </div>
                {suggestions.map((c, i) => {
                  const l = letterOf(c.name);
                  const header = l !== lastLetter && !company.trim();
                  lastLetter = l;
                  const run = runFor(c);
                  return (
                    <div key={c.slug}>
                      {header && <div className="combo-letter">{l}</div>}
                      <div
                        data-i={i}
                        role="option"
                        aria-selected={i === hi}
                        className={`combo-row ${i === hi ? "hi" : ""}`}
                        onMouseEnter={() => setHi(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCompany(c.name);
                          setOpen(false);
                        }}
                      >
                        <Avatar name={c.name} />
                        <span className="combo-name">
                          <b>{c.name}</b>
                          <span className="muted small">{c.keyword || `/${c.slug}/`}</span>
                        </span>
                        {run && <span className={`badge s-${run.status}`}>{STATUS_LABEL[run.status] ?? run.status}</span>}
                        <SvChip c={c} />
                        <ConfirmButton label="Search" busy={busy === c.slug} disabled={busy !== null} onConfirm={() => void start(c.name, c.slug)} />
                      </div>
                    </div>
                  );
                })}
                {company.trim() && !exact && (
                  <div className="combo-row free" onMouseDown={(e) => e.preventDefault()} onClick={() => void start(company)}>
                    <span className="avatar avatar-plus">+</span>
                    <span className="combo-name">
                      <b>Research “{company.trim()}”</b>
                      <span className="muted small">Not in the sheet. Research it anyway.</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <button className="primary" type="submit" disabled={busy !== null}>
            {busy === "free" || (busy && busy === exact?.slug) ? "Starting…" : "Research company"}
          </button>
        </form>
        {list && (
          <div className="hero-stats">
            <span><b>{counts.all}</b> companies</span>
            <span><b>{counts.done}</b> researched</span>
            {counts.active > 0 && <span><b>{counts.active}</b> in progress</span>}
            <span>
              <i className={`dot ${list.source === "sheet" ? "dot-ok" : "dot-muted"}`} />
              {list.source === "sheet" ? "Live from Google Sheet" : "Saved copy of the sheet"}
            </span>
          </div>
        )}
      </section>

      <ol className="steps-strip">
        {STEPS.map((s) => (
          <li key={s.n}>
            <span className="step-n">{s.n}</span>
            <span>
              <b>{s.title}</b>
              <span className="muted small"> {s.text}</span>
            </span>
          </li>
        ))}
      </ol>

      {runs && runs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Recent runs</h2>
            <span className="muted small">{runs.length} total</span>
          </div>
          <div className="run-grid">
            {runs.slice(0, 8).map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`} className="run-card">
                <div className="run-card-top">
                  <Avatar name={r.input.company} size="lg" />
                  <span className={`badge s-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <b>{r.input.company}</b>
                <span className="muted small">{timeAgo(r.createdAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="directory">
        <div className="section-head">
          <div>
            <h2>All companies</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {list === null ? "Loading the company sheet…" : "From the Educative-Company-Interview sheet. Search starts a research run for that company."}
            </p>
          </div>
          <Link href="/sheet" className="btn">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v10H2zM2 7h12M6 3v10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            Sheet settings
          </Link>
        </div>
        {list?.error && (
          <div className="warn-note small">
            {list.error} <Link href="/sheet">Open sheet settings</Link>
          </div>
        )}

        <div className="dir-toolbar">
          <div className="dir-toolbar-row">
            <label className="dir-filter">
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or keyword" aria-label="Filter companies" />
              {filter && <button type="button" className="clear" aria-label="Clear filter" onClick={() => setFilter("")}>×</button>}
            </label>
            <div className="segmented" role="group" aria-label="Status">
              {([["all", "All"], ["none", "Not researched"], ["active", "In progress"], ["done", "Researched"]] as const).map(([k, label]) =>
                k === "active" && counts.active === 0 ? null : (
                  <button key={k} type="button" className={statusFilter === k ? "active" : ""} onClick={() => setStatusFilter(k)}>
                    {label} <span className="count">{counts[k]}</span>
                  </button>
                ),
              )}
            </div>
            <div className="segmented" role="group" aria-label="Sort">
              <button type="button" className={sort === "name" ? "active" : ""} onClick={() => setSort("name")}>A–Z</button>
              <button type="button" className={sort === "sv" ? "active" : ""} onClick={() => setSort("sv")}>Search volume</button>
            </div>
          </div>
          {sort === "name" && companies.length > 0 && (
            <nav className="az-bar" aria-label="Jump to letter">
              {letters.map((l) =>
                shownLetters.has(l) ? (
                  <a key={l} href={`#letter-${l}`}>{l}</a>
                ) : (
                  <span key={l} className="off">{l}</span>
                ),
              )}
            </nav>
          )}
        </div>

        {list !== null && rows.length === 0 ? (
          <div className="panel empty muted">
            No companies match.{" "}
            <button type="button" className="link" onClick={() => { setFilter(""); setStatusFilter("all"); }}>Clear filters</button>
          </div>
        ) : (
          <div className="dir-list" role="table" aria-label="Companies">
            <div className="dir-row dir-header" role="row">
              <span role="columnheader">Company</span>
              <span role="columnheader" className="col-kw">Primary keyword</span>
              <span role="columnheader" className="col-sv">Monthly searches</span>
              <span role="columnheader" className="col-status">Status</span>
              <span role="columnheader" className="col-act" />
            </div>
            {rows.map((c, i) => {
              const run = runFor(c);
              const l = letterOf(c.name);
              const header = sort === "name" && l !== lastDirLetter;
              lastDirLetter = l;
              const pct = c.searchVolume ? Math.max(4, Math.round(Math.sqrt(c.searchVolume / maxSv) * 100)) : 0;
              return (
                <div key={c.slug} role="rowgroup">
                  {header && <div className="dir-letter" id={`letter-${l}`}>{l}</div>}
                  <div className="dir-row" role="row">
                    <span className="dir-company" role="cell">
                      {sort === "sv" && <span className="rank">{i + 1}</span>}
                      <Avatar name={c.name} />
                      <span className="combo-name">
                        <b>{c.name}</b>
                        <span className="mono muted small">/{c.slug}/</span>
                        <span className="mobile-meta small muted">
                          {c.svLabel && `${c.svLabel} searches`}
                          {run && ` · ${STATUS_LABEL[run.status] ?? run.status}`}
                        </span>
                      </span>
                    </span>
                    <span className="col-kw muted small" role="cell">{c.keyword || "—"}</span>
                    <span className="col-sv" role="cell" title={c.keyword ? `Monthly searches for "${c.keyword}"` : undefined}>
                      {c.svLabel ? (
                        <>
                          <span className="sv-num">{c.svLabel}</span>
                          <span className="sv-bar"><i style={{ width: `${pct}%` }} /></span>
                        </>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </span>
                    <span className="col-status" role="cell">
                      {run ? (
                        <Link href={`/runs/${run.id}`} className={`badge s-${run.status}`} title={`Latest run, ${timeAgo(run.createdAt)}`}>
                          {STATUS_LABEL[run.status] ?? run.status} →
                        </Link>
                      ) : (
                        <span className="muted small">Not researched</span>
                      )}
                    </span>
                    <span className="col-act" role="cell">
                      <ConfirmButton label={run ? "Search again" : "Search"} busy={busy === c.slug} disabled={busy !== null} onConfirm={() => void start(c.name, c.slug)} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

/** Avatar with a stable color per company. */
function Avatar({ name, size }: { name: string; size?: "lg" }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={`avatar ${size === "lg" ? "avatar-lg" : ""}`} style={{ "--h": h } as React.CSSProperties} aria-hidden="true">
      {name.replace(/[^a-z0-9]/gi, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/** Starting a run costs money, so the first click asks for confirmation. */
function ConfirmButton({ label, busy, disabled, onConfirm }: { label: string; busy: boolean; disabled: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`search-btn sm ${armed ? "armed" : ""}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      title={armed ? "Click again to start a research run" : "Start a research run for this company"}
    >
      {busy ? "Starting…" : armed ? "Start run?" : label}
    </button>
  );
}

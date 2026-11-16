"use client";

import { useEffect, useMemo, useState } from "react";
import { SheetSettings, type CompanyList } from "../components/SheetSettings";

/** Company sheet: where the company list comes from, and every column loaded from it. */
export default function SheetPage() {
  const [list, setList] = useState<CompanyList | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList({ companies: [], source: "none", error: "Could not load the company list." }));
  }, []);

  const companies = list?.companies ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? companies.filter((c) => c.name.toLowerCase().includes(q) || c.keyword.toLowerCase().includes(q)) : companies;
  }, [companies, filter]);
  const withPlan = companies.filter((c) => c.h1 || c.metaTitle || c.metaDescription).length;

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div>
        <h1>Company sheet</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          The list of companies and their keyword plan come from this Google Sheet. New runs save the company&apos;s row and pass it to the research, writer and SEO agents.
        </p>
      </div>

      {list === null ? <p className="muted">Loading…</p> : <SheetSettings list={list} onChange={setList} />}

      {list && (
        <section>
          <div className="section-head">
            <div>
              <h2>Loaded from the sheet</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {companies.length} companies, A–Z · {withPlan} with an H1, meta title or meta description set
              </p>
            </div>
            <input className="directory-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter companies" aria-label="Filter companies" />
          </div>
          <div className="panel table-wrap" style={{ padding: 0 }}>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Keyword</th>
                  <th>SV</th>
                  <th>Slug</th>
                  <th>Secondary keywords</th>
                  <th>H1 · Meta title · Meta description</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.slug}>
                    <td><b>{c.name}</b></td>
                    <td className="small">{c.keyword || <span className="muted">—</span>}</td>
                    <td className="small">{c.svLabel || <span className="muted">—</span>}</td>
                    <td className="mono small">{c.url || `/${c.slug}/`}</td>
                    <td className="small" title={c.secondaryKeywords?.join(", ")}>
                      {c.secondaryKeywords?.length ? `${c.secondaryKeywords.length} keywords` : <span className="muted">—</span>}
                    </td>
                    <td className="small">
                      {c.h1 || c.metaTitle || c.metaDescription ? (
                        <div className="sheet-plan">
                          {c.h1 && <span><b>H1</b> {c.h1}</span>}
                          {c.metaTitle && <span><b>Title</b> {c.metaTitle}</span>}
                          {c.metaDescription && <span><b>Description</b> {c.metaDescription}</span>}
                        </div>
                      ) : (
                        <span className="muted">Not set (agents write them)</span>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={6} className="muted">No companies match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

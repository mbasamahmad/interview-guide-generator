"use client";

import { useRef, useState } from "react";

export type SheetCompany = {
  name: string;
  slug: string;
  keyword: string;
  searchVolume: number | null;
  svLabel: string;
  url?: string;
  secondaryKeywords?: string[];
  h1?: string;
  metaTitle?: string;
  metaDescription?: string;
};
export type CompanyList = {
  companies: SheetCompany[];
  source: string;
  sheetUrl?: string;
  linkFrom?: "settings" | "env" | "none";
  copyUpdatedAt?: string | null;
  error?: string;
};

/** Where the company list comes from: paste a sheet link, reload it, or upload a CSV. */
export function SheetSettings({ list, onChange, onClose }: { list: CompanyList | null; onChange: (l: CompanyList) => void; onClose?: () => void }) {
  const [url, setUrl] = useState(list?.linkFrom === "settings" ? list.sheetUrl ?? "" : "");
  const [busy, setBusy] = useState<"" | "save" | "reload" | "upload" | "remove">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function call(kind: typeof busy, req: Promise<Response>, ok: (l: CompanyList) => string) {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await req;
      const data = await res.json();
      if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Something went wrong." });
      onChange(data);
      setMsg(data.error ? { ok: false, text: data.error } : { ok: true, text: ok(data) });
    } catch {
      setMsg({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setMsg({ ok: false, text: "Paste a Google Sheets link first." });
    void call("save", fetch("/api/companies", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }), (l) => `Saved. Loaded ${l.companies.length} companies from the sheet.`);
  };
  const remove = () => {
    setUrl("");
    void call("remove", fetch("/api/companies", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "" }) }), (l) => `Link removed. Using the saved copy (${l.companies.length} companies).`);
  };
  const reload = () => void call("reload", fetch("/api/companies?refresh=1"), (l) => `Reloaded ${l.companies.length} companies${l.source === "sheet" ? " from the sheet" : " from the saved copy"}.`);
  const upload = async (f: File) => {
    const text = await f.text();
    void call("upload", fetch("/api/companies", { method: "POST", headers: { "content-type": "text/csv" }, body: text }), (l) => `Uploaded ${f.name}: ${l.companies.length} companies.`);
  };

  const live = list?.source === "sheet";
  return (
    <div className="panel sheet-panel">
      <div className="sheet-panel-head">
        <div>
          <h3 style={{ margin: 0 }}>Sheet link</h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Paste a Google Sheets link, reload it, or upload a CSV of the sheet.</p>
        </div>
        {onClose && <button type="button" className="link" onClick={onClose}>Close</button>}
      </div>

      <div className="sheet-status">
        <span className={`badge ${live ? "s-done" : "s-pending"}`}>{live ? "Live from sheet" : "Saved copy"}</span>
        {list?.sheetUrl ? (
          <a href={list.sheetUrl} target="_blank" rel="noopener noreferrer" className="small sheet-link">
            {list.sheetUrl}
          </a>
        ) : (
          <span className="muted small">No sheet link set</span>
        )}
        {list?.linkFrom === "env" && <span className="muted small">(from COMPANY_SHEET_CSV_URL in .env.local)</span>}
        {list?.copyUpdatedAt && <span className="muted small">· copy updated {new Date(list.copyUpdatedAt).toLocaleString()}</span>}
      </div>

      <form className="sheet-form" onSubmit={save}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" aria-label="Google Sheet link" />
        <button className="primary" type="submit" disabled={!!busy}>{busy === "save" ? "Checking…" : "Save & load"}</button>
      </form>

      <div className="sheet-actions">
        <button type="button" onClick={reload} disabled={!!busy}>{busy === "reload" ? "Reloading…" : "Reload now"}</button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === "upload" ? "Uploading…" : "Upload CSV"}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        {list?.linkFrom === "settings" && (
          <button type="button" className="link danger" onClick={remove} disabled={!!busy}>Remove link</button>
        )}
      </div>

      {msg && <div className={msg.ok ? "ok-note small" : "warn-note small"}>{msg.text}</div>}

      <details className="sheet-help small">
        <summary>How to connect a sheet</summary>
        <ol>
          <li>The sheet needs a header row with a <b>Company</b> column. <b>Slug</b>, <b>Keyword</b> and <b>SV</b> columns are used when present.</li>
          <li>
            In Google Sheets, click <b>Share</b> and set General access to <b>Anyone with the link → Viewer</b>, or use <b>File → Share → Publish to web</b>.
          </li>
          <li>Paste the link above. The tab in the link is used (the <code>#gid=</code> part); without one, the first tab.</li>
          <li>If the sheet can&apos;t be shared, use <b>File → Download → CSV</b> and upload that file instead.</li>
        </ol>
        <p className="muted">The link is checked before it is saved. The list is re-read every 10 minutes, and a copy is kept so the page still works if the sheet is unreachable.</p>
      </details>
    </div>
  );
}

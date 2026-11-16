import fs from "fs";
import path from "path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./fsutil";
import type { SheetInfo } from "./store";

/**
 * Company list from a Google Sheet (columns: Company, Keyword, SV, Slug, ...).
 *
 * The sheet link is set on the home page (stored in agents/company-sheet.json; COMPANY_SHEET_CSV_URL in
 * .env.local is used when none is set there). Each successful read refreshes reference/companies.csv, the
 * local copy used whenever the sheet can't be read. A CSV can also be uploaded straight into that copy.
 */
/** One sheet row: every column (Company, Keyword, SV, Slug, Secondary Keywords, H1, Meta Title, Meta Des). */
export type SheetCompany = SheetInfo & {
  name: string;
  slug: string;
};

/** The parts of a row saved with a run. */
export function sheetInfo(c: SheetCompany): SheetInfo {
  const { name: _n, slug: _s, ...info } = c;
  return info;
}

/** Find a company by slug, or by name (case-insensitive). */
export async function findCompany(name: string, slug?: string): Promise<SheetCompany | undefined> {
  const { companies } = await getCompanies();
  return (slug && companies.find((c) => c.slug === slug)) || companies.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}

export type CompanyList = {
  companies: SheetCompany[];
  source: "sheet" | "local copy";
  sheetUrl: string; // the link as entered ("" when none)
  linkFrom: "settings" | "env" | "none";
  copyUpdatedAt: string | null;
  error?: string;
};

const LOCAL_CSV = path.join(process.cwd(), "reference", "companies.csv");
const CONFIG = path.join(process.cwd(), "agents", "company-sheet.json");
const CACHE_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __companyList?: { at: number; list: CompanyList } };

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

function parseSv(s: string): number | null {
  const m = s.trim().match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const slugOf = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Rows → companies, de-duplicated by slug and sorted A–Z by name. Needs a "Company" column. */
export function companiesFromCsv(text: string): SheetCompany[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const iName = header.indexOf("company");
  if (iName < 0) return [];
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const [iKw, iSv, iSlug] = [col("keyword", "primary keyword"), col("sv", "search volume"), col("slug", "url")];
  const [iSec, iH1, iTitle, iDesc] = [
    col("secondary keywords", "secondary keyword"),
    col("h1"),
    col("meta title", "title"),
    col("meta des", "meta desc", "meta description", "description"),
  ];
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const list = (s: string) => [...new Set(s.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean))];
  const out = new Map<string, SheetCompany>();
  for (const r of rows.slice(1)) {
    const name = cell(r, iName);
    if (!name) continue;
    // Slug column holds the URL ("/interview/companies/x/"); its last segment is the company slug.
    const slug = slugOf(cell(r, iSlug).split("/").filter(Boolean).pop() ?? "") || slugOf(name);
    if (!slug || out.has(slug)) continue;
    const svLabel = cell(r, iSv);
    out.set(slug, {
      name,
      slug,
      keyword: cell(r, iKw),
      searchVolume: parseSv(svLabel),
      svLabel: svLabel === "-" ? "" : svLabel,
      url: cell(r, iSlug) || `/interview/companies/${slug}/`,
      secondaryKeywords: list(cell(r, iSec)),
      h1: cell(r, iH1),
      metaTitle: cell(r, iTitle),
      metaDescription: cell(r, iDesc),
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Turn any Google Sheets link into its CSV download URL:
 * - .../spreadsheets/d/<id>/edit#gid=<gid>      → .../d/<id>/export?format=csv&gid=<gid>
 * - .../spreadsheets/d/e/<pubId>/pubhtml?gid=…  → .../d/e/<pubId>/pub?output=csv&gid=…
 * Other URLs (already CSV, or another host) are used as given.
 */
export function toCsvUrl(link: string): string {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return link.trim();
  }
  if (u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) return u.toString();
  const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null;
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
  if (pub) {
    if (u.searchParams.get("output") === "csv") return u.toString();
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  }
  const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!id) return u.toString();
  if (u.pathname.endsWith("/export") && u.searchParams.get("format") === "csv") return u.toString();
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

function readConfigUrl(): string {
  return readJson<{ url?: string }>(CONFIG)?.url?.trim() ?? "";
}

function currentLink(): { url: string; from: CompanyList["linkFrom"] } {
  const saved = readConfigUrl();
  if (saved) return { url: saved, from: "settings" };
  const env = process.env.COMPANY_SHEET_CSV_URL?.trim() ?? "";
  return env ? { url: env, from: "env" } : { url: "", from: "none" };
}

function copyUpdatedAt(): string | null {
  try {
    return fs.statSync(LOCAL_CSV).mtime.toISOString();
  } catch {
    return null;
  }
}

function readLocal(): SheetCompany[] {
  try {
    return companiesFromCsv(fs.readFileSync(LOCAL_CSV, "utf8"));
  } catch {
    return [];
  }
}

/** Download and parse a sheet link. Throws with a message a person can act on. */
export async function fetchSheet(link: string): Promise<{ csv: string; companies: SheetCompany[] }> {
  const url = toCsvUrl(link);
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter a full link starting with https://");
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`Could not reach the link (${(e as Error).message}).`);
  }
  if (res.status === 401 || res.status === 403)
    throw new Error("Google refused access: the sheet is private. Share it as \"Anyone with the link can view\", publish it to the web as CSV, or upload a CSV instead.");
  if (res.status === 404) throw new Error("Sheet not found (404). Check the link.");
  if (!res.ok) throw new Error(`The link returned HTTP ${res.status}.`);
  const csv = await res.text();
  if (/^\s*<(!doctype|html)/i.test(csv))
    throw new Error("The link returned a web page instead of CSV, usually a Google sign-in page. Share the sheet as \"Anyone with the link can view\" or upload a CSV.");
  const companies = companiesFromCsv(csv);
  if (!companies.length) throw new Error("No companies found. The first tab (or the tab in the link) needs a \"Company\" column.");
  return { csv, companies };
}

export async function getCompanies(force = false): Promise<CompanyList> {
  const cached = g.__companyList;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  const link = currentLink();
  const base = { sheetUrl: link.url, linkFrom: link.from };
  let list: CompanyList;
  if (!link.url) list = { companies: readLocal(), source: "local copy", ...base, copyUpdatedAt: copyUpdatedAt() };
  else {
    try {
      const { csv, companies } = await fetchSheet(link.url);
      writeTextAtomic(LOCAL_CSV, csv); // keep the fallback copy current
      list = { companies, source: "sheet", ...base, copyUpdatedAt: copyUpdatedAt() };
    } catch (e) {
      list = { companies: readLocal(), source: "local copy", ...base, copyUpdatedAt: copyUpdatedAt(), error: `Could not read the sheet, showing the saved copy. ${(e as Error).message}` };
    }
  }
  g.__companyList = { at: Date.now(), list };
  return list;
}

/** Test a link, then save it. Nothing is saved if the sheet can't be read. */
export async function saveSheetLink(link: string): Promise<CompanyList> {
  const { csv } = await fetchSheet(link);
  writeJsonAtomic(CONFIG, { url: link.trim(), savedAt: new Date().toISOString() });
  writeTextAtomic(LOCAL_CSV, csv);
  return getCompanies(true);
}

export async function clearSheetLink(): Promise<CompanyList> {
  writeJsonAtomic(CONFIG, {});
  return getCompanies(true);
}

/** Replace the local copy with an uploaded CSV (for sheets that can't be shared). */
export async function uploadCsv(csv: string): Promise<CompanyList> {
  if (!companiesFromCsv(csv).length) throw new Error("No companies found. The CSV needs a header row with a \"Company\" column.");
  writeTextAtomic(LOCAL_CSV, csv);
  return getCompanies(true);
}

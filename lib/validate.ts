import path from "path";

export interface ValidationResult {
  files: Record<string, string>;
  /** Pages that are incomplete or malformed; the run must not be packaged as complete. */
  errors: { file: string; problem: string }[];
  warnings: { file: string; problem: string }[];
  linksChecked: number;
  brokenLinksRemoved: { file: string; url: string; reason: string }[];
  unverifiedLinks: { url: string; reason: string }[];
  report: string;
}

const MIN_BODY_CHARS = 1500;
const PLACEHOLDER = /\b(TODO|TBD|lorem ipsum)\b|\[insert[^\]]*\]|\{\{[^}]+\}\}/i;

function stripFrontmatter(md: string): { fm: string; body: string } {
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  return m ? { fm: m[0], body: md.slice(m[0].length) } : { fm: "", body: md };
}

/** Body with fenced code removed, for heading and link scans. */
function prose(body: string): string {
  return body.replace(/^(```|~~~)[\s\S]*?^\1\s*$/gm, "");
}

function checkStructure(file: string, md: string, errors: ValidationResult["errors"], warnings: ValidationResult["warnings"]) {
  const { fm, body } = stripFrontmatter(md);
  if (!fm) errors.push({ file, problem: "Missing frontmatter (SEO metadata)." });
  const fences = body.match(/^(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 !== 0) errors.push({ file, problem: "Unclosed code fence: page is malformed or truncated." });
  const text = prose(body);
  const h1s = text.match(/^#\s+\S/gm)?.length ?? 0;
  if (h1s !== 1) errors.push({ file, problem: `Expected exactly one H1, found ${h1s}.` });
  let prev = 0;
  for (const m of text.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    const lvl = m[1].length;
    if (prev && lvl > prev + 1) warnings.push({ file, problem: `Heading level skips from H${prev} to H${lvl} at "${m[2].slice(0, 60)}".` });
    prev = lvl;
  }
  const open = (body.match(/<details>/g) ?? []).length;
  const close = (body.match(/<\/details>/g) ?? []).length;
  if (open !== close) errors.push({ file, problem: `Unbalanced <details> tags (${open} open, ${close} close).` });
  if (body.replace(/\s+/g, " ").length < MIN_BODY_CHARS) errors.push({ file, problem: `Page body is under ${MIN_BODY_CHARS} characters: likely incomplete.` });
  const ph = text.match(PLACEHOLDER);
  if (ph) errors.push({ file, problem: `Placeholder text left in page: "${ph[0]}".` });
  if (/<script|<iframe|<style/i.test(body)) errors.push({ file, problem: "Page contains <script>, <iframe> or <style>, which the guide format does not allow." });
}

async function checkUrl(url: string): Promise<{ ok: boolean; broken: boolean; reason: string }> {
  const attempt = async (method: "HEAD" | "GET") => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      return await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; interview-guide-link-checker/1.0)" },
      });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    let res = await attempt("HEAD");
    if (res.status === 405 || res.status === 403 || res.status === 404) res = await attempt("GET");
    if (res.ok) return { ok: true, broken: false, reason: String(res.status) };
    if (res.status === 404 || res.status === 410) return { ok: false, broken: true, reason: `HTTP ${res.status}` };
    // 401/403/429/5xx: many sites block automated checks; flag, don't remove.
    return { ok: false, broken: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "ENOTFOUND") return { ok: false, broken: true, reason: "domain not found" };
    return { ok: false, broken: false, reason: (err as Error).name === "AbortError" ? "timeout" : "network error" };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function validatePackage(input: Record<string, string>, opts: { checkExternal: boolean }): Promise<ValidationResult> {
  const files = { ...input };
  const errors: ValidationResult["errors"] = [];
  const warnings: ValidationResult["warnings"] = [];
  const brokenLinksRemoved: ValidationResult["brokenLinksRemoved"] = [];
  const unverifiedLinks: ValidationResult["unverifiedLinks"] = [];
  const mdFiles = Object.keys(files).filter((f) => f.endsWith(".md"));
  // Guide pages: everything except the supporting files in Extras/ (older runs' study pages there are pages too).
  const pageFiles = mdFiles.filter((f) => !/^[^/]+\/Extras\//.test(f) || /^[^/]+\/Extras\/Study-Guide\//.test(f));

  for (const f of pageFiles) checkStructure(f, files[f], errors, warnings);

  // Internal links: anything relative must resolve to a file in the package.
  for (const f of mdFiles) {
    files[f] = files[f].replace(/\[([^\]]*)\]\(((?:\.\.?\/)[^)\s#]*)(#[^)\s]*)?\)/g, (whole, text: string, rel: string) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), rel));
      if (files[target] !== undefined) return whole;
      warnings.push({ file: f, problem: `Internal link to missing page "${rel}" was converted to plain text.` });
      return text;
    });
    // Root-relative links left over are not portable in the package.
    files[f] = files[f].replace(/\[([^\]]*)\]\((\/[^)\s]*)\)/g, (whole, text: string, p: string) => {
      warnings.push({ file: f, problem: `Unresolved site-relative link "${p}" was converted to plain text.` });
      return text;
    });
  }

  // External links.
  const linkRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const urls = [...new Set(mdFiles.flatMap((f) => [...files[f].matchAll(linkRe)].map((m) => m[2])))];
  let linksChecked = 0;
  if (opts.checkExternal && urls.length) {
    const results = await mapLimit(urls, 8, async (u) => ({ url: u, ...(await checkUrl(u)) }));
    linksChecked = results.length;
    const broken = new Map(results.filter((r) => r.broken).map((r) => [r.url, r.reason]));
    for (const r of results) if (!r.ok && !r.broken) unverifiedLinks.push({ url: r.url, reason: r.reason });
    if (broken.size) {
      for (const f of mdFiles) {
        files[f] = files[f].replace(linkRe, (whole, text: string, url: string) => {
          const reason = broken.get(url);
          if (!reason) return whole;
          brokenLinksRemoved.push({ file: f, url, reason });
          return text;
        });
      }
    }
  }

  const rootDir = Object.keys(files)[0]?.split("/")[0] ?? "";
  const short = (f: string) => f.slice(rootDir.length + 1);
  const report = [
    "# Validation report",
    "",
    `Checked ${pageFiles.length} pages and ${opts.checkExternal ? `${linksChecked} external links` : "no external links (link checking was off)"} on ${new Date().toISOString().slice(0, 10)}.`,
    "",
    `## Errors (${errors.length})`,
    "",
    ...(errors.length ? errors.map((e) => `- \`${short(e.file)}\`: ${e.problem}`) : ["None."]),
    "",
    `## Broken links removed (${brokenLinksRemoved.length})`,
    "",
    ...(brokenLinksRemoved.length ? brokenLinksRemoved.map((b) => `- \`${short(b.file)}\`: ${b.url} (${b.reason}); link text kept`) : ["None."]),
    "",
    `## Links that could not be verified automatically (${unverifiedLinks.length})`,
    "",
    "These sites blocked or timed out on the automated check. They were kept; spot-check them by hand.",
    "",
    ...(unverifiedLinks.length ? unverifiedLinks.map((u) => `- ${u.url} (${u.reason})`) : ["None."]),
    "",
    `## Warnings (${warnings.length})`,
    "",
    ...(warnings.length ? warnings.map((w) => `- \`${short(w.file)}\`: ${w.problem}`) : ["None."]),
    "",
  ].join("\n");
  if (rootDir) files[`${rootDir}/Extras/validation-report.md`] = report;

  return { files, errors, warnings, linksChecked, brokenLinksRemoved, unverifiedLinks, report };
}

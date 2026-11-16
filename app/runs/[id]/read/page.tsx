"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";

type RunFile = { path: string; bytes: number };
type RunInfo = { input: { company: string }; files: RunFile[]; pages: { path: string; title: string; kind: string; url: string }[] };
type Heading = { id: string; text: string; depth: number };

// External links open in a new tab; everything else is sanitized by DOMPurify's defaults.
let hooked = false;
function sanitize(html: string) {
  if (!hooked && typeof window !== "undefined") {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") ?? "")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

const slug = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "section";

/** Render Markdown to sanitized HTML, collecting headings (with stable ids) for the table of contents. */
function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const marked = new Marked(
    markedHighlight({
      emptyLangClass: "hljs",
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
        return hljs.highlight(code, { language }).value;
      },
    }),
  );
  marked.use({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = inner.replace(/<[^>]+>/g, "");
        const base = slug(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth >= 2 && depth <= 3) headings.push({ id, text, depth });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });
  return { html: sanitize(marked.parse(md, { async: false }) as string), headings };
}

/** Our frontmatter is one `key: <JSON value>` per line. */
function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const v = line.slice(i + 2);
    try {
      meta[line.slice(0, i)] = JSON.parse(v);
    } catch {
      meta[line.slice(0, i)] = v;
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}

function resolvePath(from: string, rel: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const GROUP_LABEL: Record<string, string> = {
  "company-overview": "Company overview",
  roles: "Roles",
  "interview-process": "Interview process",
  "coding-questions": "Coding questions",
  "preparation-guides": "Preparation guides",
};

function ReaderInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [run, setRun] = useState<RunInfo | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [activeHeading, setActiveHeading] = useState("");
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/runs/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRun)
      .catch(() => setError("Could not load this run."));
  }, [id]);

  const root = run?.files[0]?.path.split("/")[0] ?? "";
  // Packages assembled since the folder change start at Company-Guide.md; older ones at README.md.
  const newLayout = !!run?.files.some((f) => f.path === `${root}/Company-Guide.md` || f.path.startsWith(`${root}/Extras/`));
  const current = search.get("path") || (root ? `${root}/${newLayout ? "Company-Guide.md" : "README.md"}` : "");

  useEffect(() => {
    if (!current) return;
    setRaw(null);
    setError("");
    fetch(`/api/runs/${id}/file?inline=1&path=${encodeURIComponent(current)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => setRaw(t))
      .catch(() => setError("Could not load this file."));
  }, [id, current]);

  // Sidebar: grouped, in reading order.
  const nav = useMemo(() => {
    if (!run) return [];
    const title = (p: string) => run.pages.find((x) => p.endsWith(`/${x.path}`))?.title;
    const rel = (p: string) => p.slice(root.length + 1);
    const files = run.files.map((f) => f.path);
    if (newLayout) {
      const name = (p: string) => p.split("/").pop()!.replace(/\.(md|json)$/, "").replace(/-/g, " ");
      const under = (dir: string) => files.filter((p) => rel(p).startsWith(`${dir}/`)).sort();
      const extras = under("Extras").filter((p) => !rel(p).startsWith("Extras/Study-Guide/"));
      const g: { title: string; items: { path: string; label: string; sub?: string }[] }[] = [
        { title: "Guide", items: ["Company-Guide.md", "Coding-Question.md"].map((f) => `${root}/${f}`).filter((p) => files.includes(p)).map((p) => ({ path: p, label: name(p) })) },
        { title: "Roles", items: under("Roles").map((p) => ({ path: p, label: name(p) })) },
        { title: "Interview types", items: under("Interview-Types").map((p) => ({ path: p, label: name(p) })) },
        { title: "Study guide (older run)", items: under("Extras/Study-Guide").map((p) => ({ path: p, label: title(p) ?? name(p) })) },
        { title: "Extras", items: extras.map((p) => ({ path: p, label: rel(p) === "Extras/README.md" ? "README" : name(p) })) },
      ];
      return g.filter((x) => x.items.length);
    }
    const overview = files.filter((p) => !/\/(interview|study-guide)\//.test(p)).sort((a, b) => (rel(a) === "README.md" ? -1 : rel(b) === "README.md" ? 1 : a.localeCompare(b)));
    const groups: { title: string; items: { path: string; label: string; sub?: string }[] }[] = [
      { title: "Overview", items: overview.map((p) => ({ path: p, label: rel(p) === "README.md" ? "Start here" : rel(p).replace(/\.md$|\.json$/, "").replace(/^seo\//, "SEO ").replace(/^data\//, "CMS ") })) },
      {
        title: "Landing pages",
        items: files.filter((p) => p.includes("/interview/")).map((p) => ({ path: p, label: title(p) ?? rel(p), sub: rel(p).replace(/^interview\/companies\/[^/]+\/?/, "/").replace(/index\.md$/, "") || "/" })),
      },
    ];
    const study = files.filter((p) => p.includes("/study-guide/"));
    const folders = [...new Set(study.map((p) => rel(p).split("/")[1]))];
    for (const f of folders)
      groups.push({ title: GROUP_LABEL[f] ?? f, items: study.filter((p) => rel(p).split("/")[1] === f).map((p) => ({ path: p, label: title(p) ?? rel(p) })) });
    return groups.filter((g) => g.items.length);
  }, [run, root, newLayout]);
  const flat = nav.flatMap((g) => g.items);
  const idx = flat.findIndex((x) => x.path === current);

  const doc = useMemo(() => {
    if (raw === null) return null;
    if (current.endsWith(".json")) {
      let pretty = raw;
      try {
        pretty = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {}
      return { meta: {}, html: `<pre><code class="hljs language-json">${hljs.highlight(pretty, { language: "json" }).value}</code></pre>`, headings: [] as Heading[] };
    }
    const { meta, body } = splitFrontmatter(raw);
    const r = renderMarkdown(body);
    return { meta, ...r };
  }, [raw, current]);

  // Highlight the TOC entry for the section in view.
  useEffect(() => {
    if (!doc?.headings.length || mode !== "rendered") return;
    const els = doc.headings.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActiveHeading(vis.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [doc, mode]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [current]);

  const go = useCallback((p: string, hash = "") => router.push(`/runs/${id}/read?path=${encodeURIComponent(p)}${hash}`), [router, id]);

  // Internal links between generated pages open in the reader.
  function onArticleClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault();
    if (href.startsWith("#")) {
      document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const [p, hash] = href.split("#");
    const target = resolvePath(current, p);
    if (run?.files.some((f) => f.path === target)) go(target, hash ? `#${hash}` : "");
  }

  if (error && !run) return <div className="errors">{error}</div>;
  if (!run) return <p className="muted">Loading…</p>;

  const meta = doc?.meta ?? {};
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const keywords = Array.isArray(meta.secondaryKeywords) ? (meta.secondaryKeywords as string[]) : [];
  const hasMeta = Object.keys(meta).length > 0;
  const shown = new Set(["title", "metaDescription", "h1", "primaryKeyword", "secondaryKeywords", "searchIntent", "pageType", "url", "canonical", "lastUpdated", "lastVerified", "suggestedSlug", "generatedBy"]);
  const extra = Object.entries(meta).filter(([k, v]) => !shown.has(k) && !(Array.isArray(v) && v.length === 0));

  return (
    <div className="reader">
      <aside className="reader-nav">
        <Link href={`/runs/${id}`} className="back-link">← {run.input.company} run</Link>
        {nav.map((g) => (
          <div key={g.title} className="reader-group">
            <div className="pm-nav-title">{g.title}</div>
            {g.items.map((it) => (
              <button key={it.path} className={`reader-item ${it.path === current ? "active" : ""}`} onClick={() => go(it.path)} title={it.path.slice(root.length + 1)}>
                <span>{it.label}</span>
                {it.sub && <span className="reader-item-sub mono">{it.sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="reader-main">
        <div className="reader-toolbar">
          <span className="mono muted small reader-path">{current.slice(root.length + 1)}</span>
          <div className="row" style={{ gap: 8 }}>
            {!current.endsWith(".json") && (
              <div className="segmented">
                <button className={mode === "rendered" ? "active" : ""} onClick={() => setMode("rendered")}>Rendered</button>
                <button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>Markdown</button>
              </div>
            )}
            <a className="btn" href={`/api/runs/${id}/file?path=${encodeURIComponent(current)}`}>Download</a>
          </div>
        </div>

        {error && <div className="errors">{error}</div>}
        {!doc && !error && <p className="muted">Loading…</p>}

        {doc && mode === "rendered" && (
          <>
            {hasMeta && (
              <section className="meta-card">
                <div className="meta-top">
                  {str("pageType") && <span className="tag custom">{str("pageType").replace(/-/g, " ")}</span>}
                  {str("searchIntent") && <span className="tag">{str("searchIntent")} intent</span>}
                  {str("lastUpdated") && <span className="muted small">Updated {str("lastUpdated")}</span>}
                  {str("lastVerified") && <span className="muted small">· verified {str("lastVerified")}</span>}
                </div>
                <div className="serp">
                  <div className="serp-url mono">{str("canonical") || str("url") || str("suggestedSlug")}</div>
                  <div className="serp-title">{str("title")}</div>
                  <div className="serp-desc">{str("metaDescription") || <span className="muted">No meta description</span>}</div>
                </div>
                <div className="meta-keywords">
                  {str("primaryKeyword") && <span className="chip chip-primary">{str("primaryKeyword")}</span>}
                  {keywords.map((k) => <span key={k} className="chip">{k}</span>)}
                </div>
                {extra.length > 0 && (
                  <details className="meta-more">
                    <summary>All page settings</summary>
                    <table>
                      <tbody>
                        {extra.map(([k, v]) => (
                          <tr key={k}>
                            <th>{k}</th>
                            <td className="mono">{typeof v === "string" ? v : JSON.stringify(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </section>
            )}
            <article ref={articleRef} className="doc" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: doc.html }} />
          </>
        )}

        {doc && mode === "source" && raw !== null && (
          <pre className="doc-source"><code className="hljs language-markdown" dangerouslySetInnerHTML={{ __html: hljs.highlight(raw, { language: "markdown" }).value }} /></pre>
        )}

        {idx >= 0 && (
          <nav className="pager">
            {idx > 0 ? (
              <button onClick={() => go(flat[idx - 1].path)}><span className="muted small">Previous</span><span>{flat[idx - 1].label}</span></button>
            ) : <span />}
            {idx < flat.length - 1 && (
              <button className="next" onClick={() => go(flat[idx + 1].path)}><span className="muted small">Next</span><span>{flat[idx + 1].label}</span></button>
            )}
          </nav>
        )}
      </main>

      <aside className="reader-toc">
        {doc && doc.headings.length > 0 && mode === "rendered" && (
          <>
            <div className="pm-nav-title" style={{ marginLeft: 0 }}>On this page</div>
            {doc.headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className={`toc-link d${h.depth} ${activeHeading === h.id ? "active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {h.text}
              </a>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ReaderInner />
    </Suspense>
  );
}

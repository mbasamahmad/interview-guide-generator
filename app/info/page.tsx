import Link from "next/link";

export const metadata = { title: "Info · Interview Guide Generator" };

type Row = { name: string; does: string; agent?: string; cost: "paid" | "free" };

const RESEARCH: Row[] = [
  { name: "Company research", does: "Searches the web for what the company does, its products, tech stack, engineering culture, values and recent news.", agent: "Company", cost: "paid" },
  { name: "Role discovery", does: "Finds the computer science roles the company hires for, from its careers page and job postings, with a one-line description, skills and level expectations for each.", agent: "Role", cost: "paid" },
  { name: "Interview loop discovery", does: "Works out the company's interview rounds (coding, system design, behavioral and so on), with each round's format, length, who faces it, the timeline, and how it changes by level.", agent: "Interview", cost: "paid" },
  { name: "Coding topics and questions", does: "Finds the coding topics the company emphasizes and builds a question set, each with a full solution and a label saying whether it was reported at the company.", agent: "Coding", cost: "paid" },
  { name: "Choose roles and interview types", does: "Pauses for you to pick which of the discovered roles and interview types get guide pages; its time is how long the run waited for your choice.", cost: "free" },
  { name: "Plan pages", does: "Turns your choice into the list of pages to write: the company guide, the coding questions page, one page per role and one per interview type. No AI is used.", cost: "free" },
];

const PAGE_STAGES: Row[] = [
  { name: "Write", does: "Writes the page in Markdown from the research, following the page's template and sections.", agent: "Content Writing", cost: "paid" },
  { name: "Interactive", does: "Adds interactive elements such as collapsible answers, checklists and self-check questions.", agent: "Interactive", cost: "paid" },
  { name: "SEO", does: "Sets the title, meta description, H1, keywords and internal links, following the company sheet's keyword plan where it has one.", agent: "SEO", cost: "paid" },
  { name: "QA", does: "Proofreads the page, checks its claims against the research, and fixes or removes bad links.", agent: "Proofreading / QA", cost: "paid" },
];

const FINALIZE: Row[] = [
  { name: "Assemble files", does: "Builds the final files: page settings, linked pages, README, sources, SEO metadata, the research report and the company's CMS entry.", cost: "free" },
  { name: "Validate", does: "Checks every page's structure and links, removes broken links, and writes the validation report.", cost: "free" },
  { name: "Build ZIP", does: "Packs everything into one ZIP: a folder named after the company with Company-Guide.md, Coding-Question.md, Roles/, Interview-Types/ and Extras/ (report, sources, SEO, CMS entry, validation).", cost: "free" },
];

function StepTable({ rows, showAgent = true }: { rows: Row[]; showAgent?: boolean }) {
  return (
    <div className="panel table-wrap info-table" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: "24%" }}>Step</th>
            <th>What it does</th>
            {showAgent && <th style={{ width: "16%" }}>Agent</th>}
            <th style={{ width: 90 }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td><b>{r.name}</b></td>
              <td>{r.does}</td>
              {showAgent && <td className="muted small">{r.agent ?? "None"}</td>}
              <td>{r.cost === "paid" ? <span className="badge s-running">Uses AI</span> : <span className="badge s-done">Free</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InfoPage() {
  return (
    <div className="grid info-page" style={{ gap: 28 }}>
      <div>
        <h1>How a run works</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          What each step on a run page does. Steps marked “Uses AI” call a model and add to the run&apos;s cost; free steps run in the app.
          Each AI step&apos;s instructions can be edited on the <Link href="/prompts">Prompts</Link> page.
        </p>
      </div>

      <section>
        <h2>Research and planning</h2>
        <p className="muted small">The company name is the only input. Company and role research run first; interview and coding research then use the roles found.</p>
        <StepTable rows={RESEARCH} />
      </section>

      <section>
        <h2>Page stages</h2>
        <p className="muted small">Every planned page goes through these four stages in order. Several pages are worked on at once.</p>
        <StepTable rows={PAGE_STAGES} />
      </section>

      <section>
        <h2>Finalize</h2>
        <StepTable rows={FINALIZE} showAgent={false} />
      </section>

      <section>
        <h2>Re-running</h2>
        <div className="panel info-notes">
          <p><b>Retry</b> appears on a failed step and runs it again.</p>
          <p>
            <b>Re-run</b> appears on finished research steps and opens the <b>Re-run research</b> panel. Re-running roles also re-runs interview and coding research, because both use the role list.
            You choose whether to update only the research (report and ZIP) or also rewrite the pages that use it.
          </p>
          <p>Choices you don&apos;t touch, finished pages and other research are kept.</p>
        </div>
      </section>
    </div>
  );
}

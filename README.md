# Interview Guide Generator

Enter a company name, nothing else. Research agents find the roles the company hires for, its interview loop and the coding topics it emphasizes. You choose which roles and interview types to cover, and the writing agents produce a guide for every level, from entry to staff, as separate Markdown files in a ZIP.

The page model follows `reference/hub-map-and-page-factory.md` (the Hub Map and Page Factory doc).

## Run it

```bash
./run.sh                 # dev server on http://localhost:3000
./run.sh prod            # production build, then start
./run.sh dev -p 4000     # another port
```

`run.sh` checks for Node 20+, installs dependencies when needed, and creates `.env.local` from the example if it's missing. It reports which provider keys are set and stops if the port is busy. In `prod` mode it also refuses to build while this project's dev server is running.

Add a key for each provider your agents use to `.env.local`, then restart.

- **Generate** (`/`): start a run and see recent runs.
- **Run page** (`/runs/<id>`): shows live status for each agent and page (with its provider and model), estimated cost and errors. You can retry a failed step, re-run any page from any stage, preview pages, and download single files or the ZIP.
- **Prompts** (`/prompts`): edit each agent's prompt, provider, model and effort. You can also enable or disable optional agents, view version history, restore a version or the default, and test a draft prompt on sample input.

## Providers: Claude, OpenAI, Gemini

Each agent picks its own provider on the Prompts page, so you can mix them, for example Claude for research and Gemini for SEO. Add the key for each provider you use to `.env.local` and restart the server:

| Provider | Key | Web research uses | Structured output uses |
| --- | --- | --- | --- |
| Claude | `ANTHROPIC_API_KEY` | web search + web fetch tools | JSON schema output format |
| OpenAI | `OPENAI_API_KEY` | Responses API `web_search` tool | strict JSON schema (`zodTextFormat`) |
| Gemini | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Google Search grounding | `responseJsonSchema` |

- The model field suggests models fetched from the provider's API, and you can also type any model name. Effort maps to Claude effort, OpenAI reasoning effort, or Gemini thinking level.
- The research agents need a model that supports its provider's web search.
- Costs are estimated for Claude only. OpenAI and Gemini calls show token counts and are marked "not priced".

## Prompts are files

```text
agents/<agent>/
  prompt.md          the live prompt, read fresh on every step
  prompt.default.md  the original, used by "Restore default"
  config.json        provider, model, effort, enabled
```

- Saving on the Prompts page overwrites `prompt.md` and `config.json`.
- Editing `prompt.md` in any editor also works. The next step uses it, and the Prompts page lists the change as a version marked "Edited on disk".
- Every version is kept in `data/prompt-history/<agent>/v<N>.json`, so you can view or restore it. Each run step records the prompt version it used.

Optional environment variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `PAGE_CONCURRENCY` | `4` | Pages processed in parallel |
| `CHECK_EXTERNAL_LINKS` | `true` | `false` skips the external link check |

## Output

```text
<company>-interview-preparation/
├── README.md
├── interview/companies/<company>/          Landing pages: one index.md per Hub Map URL
│   ├── index.md                             company page
│   ├── <role>/index.md                      company × role (one per role you chose)
│   ├── <interview-type>/index.md            company × interview type (one per type you chose)
│   └── coding-questions/index.md            company coding questions
├── study-guide/                             In-depth study pack
│   ├── company-overview/  interview-process/
│   ├── roles/<role>.md                      one page per chosen role, with expectations by level
│   ├── coding-questions/<topic>.md          full solutions in collapsible blocks
│   └── preparation-guides/
├── data/<company>.company.json              CMS entry for the Company content type, with interview rounds
├── sources.md                               every source, with dates
├── seo/seo-metadata.md                      per-page SEO metadata (also in each page's frontmatter)
└── validation-report.md                     structure, link and QA checks
```

Landing-page frontmatter carries the Guide settings from the doc: slug, url, parent, canonical, index flag, sitemap segment, CTA criteria, title, meta description, H1, keywords, last verified, and last updated.

## How it works

1. **Discover, stage 1**, in parallel: the Company agent researches the company. The Role agent reads the careers page and job postings to find the roles it hires for, maps them to taxonomy slugs, and rates the evidence for each.
2. **Discover, stage 2**, in parallel, given those roles: the Interview agent maps the loop round by round, records which roles each round applies to and how the loop changes by level. The Coding agent finds the topics the company emphasizes and writes questions with solutions. Every research agent uses its provider's web search. A second call converts the notes to schema-checked JSON, keeping source URLs, dates and a confidence label (verified, reported or inferred) on each finding.
3. **Choose**: the run pauses. The run page shows the roles, interview types and coding focus that were found, with their evidence. You tick what to cover and see the page count before continuing.
4. **Plan**: pages are built from your choice. Each page gets only the research relevant to it; a role page, for example, gets only that role and the rounds it faces.
5. **Pages**: each page goes through write → interactive → SEO → QA. Every stage is its own step, so a failure only blocks that page.
6. **Finalize**: assemble the files, rewrite internal links to relative paths, then validate. Validation checks for one H1, closed code fences, balanced `<details>`, minimum length and placeholders, and checks every link. Broken links are unlinked, and links that can't be verified are listed in the report. Any page error stops packaging, and the run page says which pages to re-run.

Code map: `agents/` (prompt files), `lib/agents/defaults.ts` (agent metadata), `lib/prompts.ts` (prompt files and history), `lib/llm/` (Claude, OpenAI and Gemini adapters), `lib/agents/schemas.ts` (data exchanged between agents), `lib/pipeline.ts` (orchestration and retry), `lib/pages.ts` (page plan), `lib/assemble.ts`, `lib/validate.ts`, `lib/store.ts` (run storage).

Runs and prompt history are stored under `data/` (`data/runs/<id>.json`, `data/prompt-history/`). That folder is git-ignored. The `agents/` folder is not ignored, so prompt changes can be committed.

## Cost and time

All agents default to Claude `claude-opus-5-5`. A run is about 20–30 pages × 4 stages plus 4 research agents, roughly 100 model calls and 50 web searches. The run page shows the estimated cost as it goes. To cut cost, lower effort or switch the interactive, SEO and QA agents to a smaller model on the Prompts page, or disable them.

Claude requests opt into server-side refusal fallback (`fallbacks: "default"`). If a model declines a request for policy reasons, the API retries it on a fallback model within the same call.

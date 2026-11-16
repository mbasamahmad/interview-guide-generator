# Interview Prep Pages: Hub Map and Page Factory

The interview prep ecosystem is organized by four taxonomy dimensions. Three hubs and one page per interview type sit under /interview/, beside a /grokking/ brand hub, and the Guide, a single Landing Page Factory template, builds every page that needs to scale. Hubs are built as one-offs.&#32;

## Taxonomy

Three dimensions get their own pages: interview type, company and role. Coding patterns and everything else are filters.

| Dimension | Values (fixed lists) | Own pages? |
| --- | --- | --- |
| Interview type | coding, system-design-interview, tech-screen, low-level-design, api-design, behavioral, engineering-management, debugging, code-review, ai-assisted-coding, case-study | Yes |
| Company | The 207 companies in the priority spreadsheet, using its slugs: anthropic, google, meta | Yes |
| Role | software-engineer, engineering-manager, product-manager, data-scientist, data-engineer, machine-learning-engineer, research-engineer, security-engineer, frontend, forward-deployed-engineer | Yes (P1) |
| Coding pattern | Grokking pattern names: two-pointers, sliding-window | Not for now |
| Difficulty, seniority, topic | Easy to hard, levels, data structures | No, filters only |

### Hub pages

Three hubs plus one page per interview type sit under /interview/, and /grokking/ sits beside them as the brand hub. There are only a few hubs, so each one is built as a one-off outside the factory.

| Hub | URL | Lists | Template | Owner | Priority |
| --- | --- | --- | --- | --- | --- |
| Interview prep home | /interview/ (existing) | Every interview type page, top companies and roles | One-off | Marketing | P0 |
| Companies | /interview/companies/ | A–Z companies | One-off | Marketing | P0 |
| Interview type pages | /interview/{type}/ | One page per interview type; /interview/coding/ doubles as the Practice Hub | Guide (/interview/coding/ is the Practice Hub) | Marketing, Product | P0 |
| Roles | /interview/roles/ | Every role | One-off | Marketing | P1 |
| Grokking | /grokking/ | The Grokking course series, linking to existing course pages | One-off | Marketing | P0 |

### Spoke page URL patterns

| Page | URL pattern | Example | Template |
| --- | --- | --- | --- |
| Company page | /interview/companies/{company}/ | /interview/companies/anthropic/ | Guide |
| Company × role guide | /interview/companies/{company}/{role}/ | /interview/companies/anthropic/software-engineer/ | Guide |
| Company × interview type page | /interview/companies/{company}/{type}/ | /interview/companies/anthropic/system-design-interview/ | Guide |
| Company coding questions | /interview/companies/{company}/coding-questions/ | /interview/companies/anthropic/coding-questions/ | Guide |
| Role page | /interview/roles/{role}/ | /interview/roles/software-engineer/ | Guide |
| Problem page (existing) | /courses/{course}/{problem} | /courses/grokking-coding-interview-in-python/valid-palindrome | None, outside the factory |

### Nesting rules

- Anything about one company lives under that company.
- Pages about an interview type with no company live at /interview/{type}/.
- Difficulty, seniority and topic stay filters and never get their own URLs.
- /grokking/ targets branded searches and links to the existing Grokking course pages.

## Page factory

Guide pages run through the Landing Page Factory. Each page combines the Guide template, a CMS entry and live data, so Marketing and Content can publish new pages without engineering.

- **Template:** layout and modules, built once by Eng.
- **CMS entry:** editorial fields written by Content and Marketing.

### Content types

| Content type | Key fields |
| --- | --- |
| Company | Name, slug, logo, overview, rounds (type, AI rules, format, length, sources, last verified date) |
| Role | Name, slug, overview, related patterns |
| Pattern | Name, slug, summary, Grokking lesson link |
| Interview type | Name, slug, overview, AI rules, linked drills |
| Guide | Sections, FAQ, mapped problems, author, reviewer, last updated date, related entries |

Every content type also carries a target keyword, secondary keywords, title, meta description, H1, canonical, index flag and CTA settings.

### Prerequisites

1. Company, role, difficulty and pattern tags on every problem, so templates can map problems to pages.
2. A CMS with structured entries that Marketing can publish without a deploy. An existing CMS works if it supports custom fields (might need to modify Landing Page Factory to accommodate this).

## Templates

The Landing Page Factory needs one template: the Guide. Guide pages scale into the hundreds, so they run through the factory. Hubs are few, so each one is built as a one-off. The Practice Hub (/interview/coding/) and problem pages belong to Content and Product and sit outside the factory.

| Template | Pages it builds | Built as | Owner |
| --- | --- | --- | --- |
| Guide | Company pages, company × role, company × interview type, company coding questions, role pages, interview type pages except coding | Landing Page Factory template | Marketing |
| Hub | /interview/ (existing), /grokking/, and the Companies and Roles hubs | One-offs | Marketing |

**Sample pages to design:** one Guide per page type, all for Anthropic, so page type is the only thing that differs.

| Page type | Sample |
| --- | --- |
| Company | /interview/companies/anthropic/ |
| Company × role | /interview/companies/anthropic/software-engineer/ |
| Company × interview type | /interview/companies/anthropic/system-design-interview/ |
| Company coding questions | /interview/companies/anthropic/coding-questions/ |

**Next:** Anum and Zach design the four Guide samples, and Eng builds the Guide template from them.

**Build order:** Search volume in the priority spreadsheet decides what ships first: company pages and the Companies hub, then company × role, company × interview type and company coding questions. Standalone role pages run on their own volume instead of waiting for the company queue. One caveat: a role's headline search volume may belong to a career-intent page outside /interview/ rather than to the role page itself. "Forward deployed engineer" at \~9.9K/mo is served by a hardcoded hub at educative.io/forward-deployed-engineer; /interview/roles/forward-deployed-engineer/ targets the smaller interview term set and ships alongside the first company pages.

**See list of pages to build: **<https://docs.google.com/spreadsheets/d/1m1dqMHLxWMwUz5dDEoi22yc2n3pj7MTYZQwYaCGMTY4/edit?gid=664916960#gid=664916960>

**Settings on every Guide page:** URL slug, parent page (sets breadcrumbs), target keyword, secondary keywords, title, meta description, H1, canonical, index flag and sitemap segment.

### Guide

Editorial pages about a company, role, interview type or a combination of them. The page's criteria decide which optional sections appear. /interview/system-design-interview/ is a Guide; /interview/coding/ is the Practice Hub and sits outside the factory. Company coding questions pages are Guides whose main section is the question list.

| Section | Shows on | Settings |
| --- | --- | --- |
| Breadcrumbs | Every page | Parent page |
| Hero with primary CTA | Every page | H1, intro, pre-filled criteria (company, role, interview type) |
| At a glance | Every page except role pages | Rounds, format, length, AI rules, last verified date |
| Loop timeline | Pages with a company | Rounds in order |
| Table of contents | Every page | Automatic, from body headings |
| Body sections | Every page | Headings and copy |
| Mapped problems and pattern chips | Every page; the main section on coding questions pages | Problem criteria or a hand-picked list, linking into the course player |
| Companies that run this round | Interview type pages | Companies to list |
| Drills | Debugging, code review and AI-assisted coding pages | Linked drills |
| FAQ | Every page | Questions and answers |
| Author, reviewer and last updated | Every page | Names, date, changelog |
| Related pages | Every page | Automatic or hand-picked |

### Hubs

Hubs list other pages: /interview/ lists interview types, top companies and roles, and /interview/companies/ lists every company A–Z. There are only four, so each one is built by hand and needs no factory template.

### Primary CTA: personalized interview prep

Every spoke page carries the same primary CTA: start personalized interview prep, with the page's criteria pre-filled in the PAL roadmap. Since the CTA is identical on every page, each page's content can be optimized for its own keyword and search intent.

| Page type | Pre-filled criteria |
| --- | --- |
| Company page | Company |
| Company × role guide | Company, role |
| Company coding questions | Company |
| Role page | Role |
| Interview type page | Interview type, such as system design |
| Company × interview type page | Company, interview type |

- **One component:** a single CTA module, configured per page, fires one conversion event that records the page's criteria.
- **Coding questions pages:** "Start practice" stays as a second button for visitors who arrive ready to practice.
- **Fallback:** when PAL can't use a criterion, such as an unsupported company, the roadmap opens with the criteria it can use.
- **Preview first:** visitors see a preview of their plan before signup asks for an account.
- **Crawling:** the CTA's links into the app carry parameters, so those URLs stay out of the index.
- **Dependency:** PAL needs to accept pre-filled company, role, pattern, round and interview type from the CTA.

## URL rules

Every new interview prep page lives under /interview/. Problem pages stay in the course player under /courses/, and /grokking/ stays at the top level as the brand hub.

- **Why /interview/:** One folder keeps Search Console reporting, robots rules and breadcrumbs in one place. "Interview" also opens every URL, matching the word every target search includes.
- **Existing /guide(s)/ pages:** Interview pages with traffic get 301 redirects to the matching interview type or company page. Anything unrelated to interviews stays where it is.
- **Format:** Lowercase, hyphens and full words: /software-engineer/, not /swe/.
- **Folders:** Plural names for directories: /companies/ and /roles/.
- **No years:** The year goes in titles, so URLs never need to change.
- **Slugs from fixed lists:** Company slugs come from the priority spreadsheet (/anthropic/, /google/). Interview types, roles and patterns come from the taxonomy table.
- **Reserved slugs:** Interview type slugs, /companies/ and /roles/ are reserved under /interview/.
- **Stability:** Every URL ends in a slash, and a published slug changes only with a 301.

## SEO controls

Every page carries its own SEO settings.

- **Per-page controls:** index flag, canonical, title, meta, H1, sitemap segment and auto-generated structured data.
- **Filters:** Filter and sort parameters stay out of the index.
- **Linking:** Breadcrumbs link every page up to its hub. Each page also links across to its company, coding questions page and role.
- **Freshness:** Every page shows a last updated date, and company rounds data gets a monthly review.

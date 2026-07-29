# intervu.cc — Elite company signal (Tier A + B)

**Date:** 2026-07-29  
**Status:** approved — implemented on `feat/elite-company-signal` (plan: `docs/superpowers/plans/2026-07-29-elite-company-signal.md`)  
**Scope:** curated company boards, company intel on Find jobs, fit panel, light company pages, follow/alerts  
**Mocks:** `docs/design/elite-company-signal/` (gallery: `99-gallery.html`)  
**Related:** Phase 1 search journey (`2026-07-25-search-journey-phase1-design.md`) — this design *extends* the SERP after the single-line journey works; it does not replace it. Absorbs deferred Phase 1.5 company hiring counts.

---

## Goal

A seeker can decide **whether the company is a good bet** in two seconds on a job card, then use Intervu’s existing loop (tailor → track → prep) without leaving the product. Company quality is scannable; application quality stays Intervu’s job.

## The one rule

> Show company *observations* Intervu can defend — never fundraising theater we don’t own.

Opened/closed role counts, open-role totals, ghost-flagged share, curated allowlists: in.  
Secondary valuations, Caplight, Glassdoor culture clones, employer Hire marketplace: out.

## Persona

**Maya** — senior engineer targeting quality startups. Hates ghost jobs and wasted applications. Will scan a footer strip before reading a JD.

---

## Non-goals

- Employer / recruiter Hire marketplace (TrueUp Hire tab)
- Trajectory Score as a proprietary black-box rank competing with TrueUp
- Full financials, layoff dossiers, podcast embeds on company pages
- Replacing ghost-job signal (it stays; company intel stacks *with* it)
- Blocking Find jobs behind auth
- Building a separate “companies product” that orphans the job SERP

---

## Product shape

Three surfaces share one curated company universe:

| Surface | Route (proposed) | Job |
|---|---|---|
| Find jobs + boards | `/` (chips) | Filter corpus to allowlisted companies; intel on cards |
| Hot companies | `/companies` or `/companies/hiring` | Rank by observed hiring heat |
| Company page | `/co/[slug]` or `/company/[slug]` | Jobs + KPIs + Follow + jump to prep |

Fit is **not** a route — it is a drawer on the SERP / detail sheet.

---

## Customer journeys (approved)

### Tier A — discovery & fit

**A1 — Elite board filter**  
Land Find jobs → tap **Elite startups** chip → SERP narrows to allowlist → scan intel footers → open role.

**A2 — Company intel on card**  
Scan footer (`Opened N / closed M in 90d · K open roles`) → skip stagnant → open hiring-hot.

**A3 — Am I a fit?**  
Card CTA → drawer: verdict + match bullets + gaps → Tailor resume / Interview prep / Apply (tracks).

**A4 — Company page**  
Company name → light page: KPIs, open roles, Follow, Open interview prep (Company Recon).

### Tier B — retention & boards

**B1 — Hot companies**  
Open ranked list sorted by opened-in-90d (not valuation) → company → jobs.

**B2 — Follow → alert**  
Follow on company page → later in-app/email: “N new roles at companies you follow” → filtered SERP.

**B3 — Curated boards**  
Boards strip: Elite · AI · Remote-friendly — same SERP shell, different allowlists.

---

## Information architecture

### Board chips (SERP)

Horizontal chips under the search line (or pinned under the Phase 1 results chrome once that lands):

- **Elite startups** (primary curated set)
- **AI** (optional v1 if allowlist ready; else Elite-only for first ship)
- **Remote-friendly** (optional; may reuse existing work-type filter instead of a board)

Selected chip = dark fill (Intervu `#1C1B16` / green accent for “live” chips — match `docs/design/elite-company-signal/02-serp-elite.html`).  
Chip applies a **company-domain allowlist filter** in Meilisearch (or post-filter if index facet not ready).

**Relationship to Phase 1 “no filter chips”:** Phase 1 banned *generic* facet panels. Curated boards are a different object: one-tap *editorial* scopes, max ~3, not a facet warehouse. They ship after (or alongside) the single-line journey, never as a replacement for it.

### Job card additions

Keep title-dominant hierarchy from Phase 1. Add below meta (or as card footer):

1. Ghost / freshness flag (existing)
2. Text button: **Am I a fit?**
3. Intel strip (mono, muted):

```
Early-stage · Opened 14 / closed 3 in 90d · 18 open roles
```

Rules:
- Counts only — never averages of time-to-close (see Phase 1.5 rejection note).
- If we lack stage, omit the stage token; do not invent it.
- If we lack 90d stats, show only `K open roles` or omit strip — never fake zeros that look like data.
- No salary unless already present on the listing.
- No investor logos / valuation on the card.

### Am I a fit? drawer

~360–400px right drawer over SERP (mock: `03-fit-panel.html`).

| Block | Source |
|---|---|
| Role + company | Job record |
| Verdict (Strong / Stretch / Weak) | Resume↔JD match (reuse tailor/analysis path) |
| 3 match bullets + ≤2 gaps | Same |
| CTAs | Tailor resume · Interview prep · Apply |
| Footnote | “Uses your active resume · N credits” |

Auth: guests can open the drawer and see a short teaser + sign-in to run full match (same pattern as credit-gated generations). Do not invent a parallel scoring system — wire to existing resume-tailor / job analysis actions.

### Company page (light)

Mock: `04-company-page.html`.

- Header: logo, name, one-liner, **Elite** (or board) chip, **Follow**
- KPI strip: Open roles · Opened 90d · Closed 90d · Ghost-flagged %
- Open roles list (link into job detail / Apply)
- Sticky: View all jobs · Open interview prep
- Explicitly absent: valuation, Caplight, culture reviews, layoff encyclopedia

Slug: derive from `company` + `company_domain` already on job types (`src/lib/jobs/types.ts`). Prefer domain-stable slugs.

### Hot companies (Tier B)

Mock: `05-hot-companies.html`.

Columns: Rank · Company · one-liner · Hiring heat (opened/90d) · Open roles · Follow.  
Subtitle must state metric = **observed openings in window**, not fundraising.

### Follow + alerts (Tier B)

- Follow stores `{ userId, companySlug|domain }` in Firestore (signed-in) or localStorage (guest, merge on sign-in — mirror pursuits guest store).
- Alert payload: new jobs whose `company_domain` is in followed set since last check.
- v1 delivery: in-app notification surface + optional email if a channel already exists; do not build a new ESP for this feature alone.
- Mock alert card: `06-boards-follow.html`.

---

## Data model

### Company allowlists (boards)

```
boards/{boardId}          // elite | ai | …
  name, description
  domains: string[]       // lowercase registrable domains
  updatedAt
```

Bootstrap: hand-curated Elite seed + intersect with domains already in Meilisearch / `data/job-boards-domains-*.txt`. Editorial, not scraped rank.

### Per-company aggregates (Phase 1.5 absorbed)

Computed in sync/worker (off-repo sync job noted in `meilisearch.ts`), stored either:

- Meilisearch document fields on each job (`company_opened_90d`, `company_closed_90d`, `company_open_count`), denormalized for SERP speed, **or**
- A `companies` index / Firestore `companies/{domain}` doc joined at read time

**Definition (must be pinned in code comments + UI tooltip):**

- **Opened 90d:** distinct roles first-seen in the last 90 days for that domain.
- **Closed 90d:** distinct roles that disappeared in the last 90 days (disappearance ≠ filled — same honesty as Phase 1.5).
- **Open roles:** currently live count.
- **Ghost-flagged %:** share of currently open roles with ghost/stale badge.

Reject “average days to close.”

### Follow

```
users/{uid}/followedCompanies/{domain}
  domain, slug, displayName, createdAt
```

Guest: `localStorage` key parallel to `guest-store` pursuits.

---

## Architecture / data flow

```
Board chip selected
  → searchJobs({ …, board: 'elite' })
  → Meilisearch filter: company_domain IN allowlist
  → cards render denormalized company_* fields + ghost flag

Am I a fit?
  → require active resume (or prompt)
  → existing job-analysis / tailor action
  → drawer renders structured verdict

Company page
  → load companies/{domain} aggregates + search jobs by domain
  → Follow writes followedCompanies
  → Open prep deep-links /prep with company+role context

Alert cron / on-demand
  → for each follower, new jobs since cursor matching domains
  → enqueue notification
```

---

## Phased delivery

| Phase | Ships | Depends on |
|---|---|---|
| **A0** | Company aggregate fields in index + honest empty states | Sync worker |
| **A1** | Elite chip + allowlist filter on `/` | A0 optional (chip works with domain filter alone) |
| **A2** | Intel strip on cards | A0 |
| **A3** | Am I a fit? drawer → existing tailor/prep/apply | Resume active |
| **A4** | `/co/[slug]` light page | A0 + job-by-domain search |
| **B1** | Hot companies ranked view | A0 |
| **B2** | Follow + new-role alerts | A4 + notify path |
| **B3** | Additional boards (AI, …) | A1 pattern |

**Recommended first ship:** A1 + A2 + A3 (SERP-complete loop). A4 next. B\* after usage proves board demand.

---

## UX principles (Intervu, not TrueUp)

- Cream/ink/green system from portal mocks — not TrueUp blue.
- Ghost radar remains the differentiator; company intel is secondary weight.
- Title stays visually dominant on rows (Phase 1 ranking honesty).
- Desktop-first for drawer; on mobile, fit becomes a full-screen sheet.
- Dark mode: follow existing tokens; no new purple accents.

---

## Analytics (minimum)

Log (server or PostHog — match whatever search logging lands from Phase 1 prerequisite):

- `board_selected` (boardId)
- `fit_opened` / `fit_completed` (verdict)
- `company_page_view`
- `company_follow` / `unfollow`
- `alert_clicked`

No PII in event props beyond user id already used elsewhere.

---

## Testing

- Unit: allowlist filter composition; aggregate honesty (null vs zero).
- Component: card footer omit rules; fit drawer guest gate.
- E2E: select Elite → results only from seed domains; fit → tailor CTA navigates; follow persists after reload when signed in.
- Fixture: small Elite domain list + synthetic opened/closed counts.

---

## Open decisions (resolve in plan, not blockers for approval)

1. Route prefix: `/co/` vs `/company/`.
2. Whether Remote-friendly is a board or the existing work-type facet.
3. Alert channel v1: in-app only vs email.
4. Exact Elite seed size (target ~200–500 domains, not 13k).

---

## Approval gate

Mocks in `docs/design/elite-company-signal/` were accepted 2026-07-29.  
This spec captures that intent for implementation planning.

**Please review this file.** If it looks right, next step is an implementation plan via `writing-plans` (still no code until that plan is approved).

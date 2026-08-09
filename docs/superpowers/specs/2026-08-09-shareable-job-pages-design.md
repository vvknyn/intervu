# Shareable, indexable job pages (`/jobs/<slug>-<uuid>`)

**Date:** 2026-08-09 · **Status:** design, awaiting approval · **Repo:** intervu

## 1. Why

Vivek's observation, 2026-08-09: he used a job portal that had *exactly* the jobs he
wanted, and afterwards could not recall its name. Satisfaction did not produce recall.

The implication is that brand recall is not an available retention mechanic for an
early-stage entrant in this category — LinkedIn and Indeed hold those slots through a
decade of ambient repetition, not through product quality. If users will not remember
the name, they must be **re-encountered** instead. The two nameless re-encounter paths
are (a) arriving from a search engine on a specific job, and (b) receiving a link from
another person.

intervu supports neither today. Verified 2026-08-09: `src/app/jobs/page.tsx` is the only
jobs route; there is no `/jobs/[id]`. Every listing exists solely as state inside one
board page, so no job can be indexed and no job can be shared.

This spec adds the per-job URL.

## 2. Decisions locked (Vivek, 2026-08-09)

| Decision | Choice |
|---|---|
| Re-encounter surface | Shareable/indexable job URLs (over browser extension, alerts) |
| URL shape | Slug + id in one segment |
| Expired jobs | Closed-state page (not 410, not redirect) |
| Scope | Route + sharing, including dynamic per-job OG images |

## 3. ✅ RESOLVED — `ghost_badge` coverage measured, premise holds

**Measured 2026-08-09** by sampling production through the MCP `search_jobs` tool
(n=120 across 6 varied role queries, `includeGhostFlagged: true`):

| `ghost_badge` | count | share |
|---|---|---|
| `clear` | 83 | 69.2% |
| `caution` | 22 | 18.3% |
| `unscored` | 15 | 12.5% |

**~87.5% of listings carry a verdict**, so the premise below holds: the page has original
content to lead with. An initial n=2 sample had shown both jobs `unscored`, which was not
representative — this is why the census was run.

Two secondary findings from the same measurement:

- **`likely_ghost` is vanishingly rare.** On "software engineer", default `total` = 47,023
  vs. 47,078 with `includeGhostFlagged: true` — a delta of 55, or **0.12%** of the corpus.
  The §10 noindex-ghosts filter is therefore nearly a no-op. The real differentiating
  signal is the 18.3% `caution` bucket, not the flagged-ghost bucket, and page copy should
  be built around that rather than implying we reject large numbers of fakes.
- **Verdict mix varies enormously by role.** Per-query `clear`/`caution`/`unscored` of 20:
  software engineer 6/10/4, sales manager 8/2/10, nurse 16/4/0, warehouse 19/1/0,
  teacher 19/1/0. Tech and sales roles attract far more `caution`; blue-collar and
  healthcare are almost all `clear`. Worth prioritising the higher-signal segments when
  choosing what to index first, since those pages carry the most original content.

The original reasoning this gate was protecting against:

This matters because the entire SEO premise of this spec is that the job page carries
content nobody else has. The job *description* is scraped verbatim from the employer's
ATS, so it is duplicate content that Google will attribute to the employer's own site,
LinkedIn, and Indeed before us. The only original material on the page is the integrity
verdict and company hiring stats. **If most of the corpus is `unscored`, most pages ship
with no original content and the strategy does not work as designed.**

Step 0 of implementation, before any route code:

`ghost_badge` and `vacancy_status` are both in `filterableAttributes`
(`src/lib/jobs/meilisearch.ts`), so this is a facet query against the serving index —
which is the right place to measure, since it is what would actually be indexed:

```bash
# [verify-leg 1/1: ghost_badge distribution across active listings in the serving index]
curl -s -X POST "$MEILISEARCH_HOST/indexes/jobs/search" \
  -H "Authorization: Bearer $MEILI_KEY" -H 'Content-Type: application/json' \
  -d '{"q":"","filter":"vacancy_status = \"active\"","facets":["ghost_badge"],"limit":0}' \
  | jq '.facetDistribution.ghost_badge, .estimatedTotalHits'
```

**Resolution:** clear/caution majority → proceed as specced. `unscored` (12.5%) is treated
per §10: the page renders, but is excluded from the index, because a page whose only
content is someone else's job description has nothing to rank on.

## 4. Architecture

The data layer already suits server rendering — no rewrite needed.

Verified facts (2026-08-09):
- `searchJobsAction` is a server action (`src/actions/jobs.ts:73`), calling Meili over
  HTTP; there is no client-side Meili SDK.
- `id` is a filterable Meili attribute (`src/lib/jobs/meilisearch.ts:73`) and the index
  primary key (`meilisearch.ts:951`).
- A by-id lookup pattern already exists: `searchJobsAction({ id, limit: 1, offset: 0 })`
  at `src/app/jobs/page.tsx:1888`.
- `JobDetail` (`src/components/jobs/JobDetail.tsx:341`) accepts a full `PublicJob`.
- `/jobs` is public; `AUTH_GATED_PRODUCT_PREFIXES` is only `/settings`, `/account`
  (`src/lib/auth/product-routes.ts:14`).

### 4.1 New seam: `getJobById`

Add `getJobById(id: string): Promise<PublicJob | null>` in `src/lib/jobs/`.

Rationale (writing-lean-code, SOLID at the seams): the existing by-id lookup borrows
`searchJobsAction`, which drags along per-IP *search* rate limiting and anonymous
*pagination depth* capping. Neither is meaningful for "show me this one job" — it is a
lying abstraction. One honest function, two call sites (the new route and the board's
existence check at `page.tsx:1888`), so the board stops paying for search semantics it
does not use.

`getJobById` owns its own concerns: cache lookup, a by-id rate limit (§9), and returning
`null` rather than an empty search envelope.

### 4.2 Route

**Follow the existing `/co/[slug]` company page as the precedent** — it is already a
public, dynamic, indexed SEO route and establishes every pattern this route needs
(`src/app/co/[slug]/page.tsx`): `notFound()` from `next/navigation`, an async
`generateMetadata`, `params` typed as a **Promise** (Next 16 async params), and JSON-LD
injected via `<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(x) }} />`.
Do not invent a second house style for the same job.

`src/app/jobs/[slug]/page.tsx` — server component:

1. Parse the id out of `params.slug` (§5).
2. `getJobById(id)`; `notFound()` if null.
3. If `vacancy_status` is not active → closed-state render (§7).
4. Render verdict-first content (§6) with the existing `JobDetail` for the body.
5. `generateMetadata` for title/description/canonical/OG (§8).
6. Emit JobPosting JSON-LD (§8).

## 5. URL scheme

**Shape:** `/jobs/<title>-at-<company>-<uuid>`

Example: `/jobs/data-engineer-at-orange-f7357d0c-fae4-4f2e-a850-c46d991efba3`

**Parsing:** `id` is a **UUID v4 containing hyphens** (verified: `f7357d0c-fae4-4f2e-a850-c46d991efba3`).
Splitting on the last hyphen is therefore incorrect. Extract with an anchored UUID regex
on the tail of the segment:

```
/^(?<slug>.*)-(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
```

No match → `notFound()`.

**Slug is decorative, id is authoritative.** Titles change; the id does not. If the
slug in the request does not match the slug derived from the current job record, issue a
301 to the canonical URL. This keeps one indexable URL per job and prevents duplicate
content from stale shared links.

**Canonical origin** must come from `SITE_URL` (`src/lib/seo/constants.ts:15`), never a
literal. Note the fallback there is `"https://intervu.cc"` — the *old* domain — so an
unset `NEXT_PUBLIC_SITE_URL` would silently emit old-domain canonicals across the whole
site. Production currently sets it correctly (live canonical verified as
`https://intervuhq.com/jobs`). Recommend changing the fallback to the new domain or
making it throw; leaving a wrong-domain default in place is a lying fallback.

## 6. Page content order — verdict first

Because the description is duplicate content (§3), the page must lead with material
that exists nowhere else:

1. **`<h1>` — job title + company.** This stays first in the DOM; the H1 is a primary
   ranking and accessibility signal and must be the role, not a verdict banner.
2. **Employer track record, immediately under the H1** — `company_opened_90d`,
   `company_closed_90d`, `company_open_count`, `company_stage`
   (`src/lib/jobs/types.ts:56-59`), stated as concrete counts, not adjectives, and linked
   through to the company's `/co/[slug]` page. See §6.2 for why this leads rather than the
   badge. This is the highest position any original content can occupy.
3. **Integrity verdict** — `ghost_badge`, `vacancy_status`, last-checked date
   (`ghostCheckedText`, `src/components/jobs/job-detail-facts.ts:57`).
4. **Exposure** — `is_indexed_google` / `is_indexed_linkedin` with paired timestamps
   (`types.ts:68-71`, `deriveExposureBadges`, `job-detail-facts.ts:156`).
5. **Then** location, the scraped description, and the outbound `apply_url`.

The ordering rule is that every block of original content precedes the duplicate block.

This is both the SEO requirement and the product differentiator; they happen to be the
same requirement. Reuse `JobDetail` for the body rather than forking a second detail UI.

### 6.2 Why the track record leads, not the ghost badge

"We screen out ghost jobs" is a commoditized *claim* — it is cheap to assert, common in
the category, and unfalsifiable by the reader. Two measurements from this session say we
should not lead with it:

- `likely_ghost` is **0.12%** of the corpus (§3), so the badge is mostly saying "clear",
  which carries little information.
- The badge is a per-posting adjective. Any competitor can compute a similar-looking one
  from posting age and repost detection, and posting age is explicitly *not* ghostliness
  (a lesson already learned in the Aug 9 user-reports wave).

What is not commoditized is the **longitudinal employer record**: a count of what a
company opened and closed over 90 days, derived from having watched the corpus over time.
A new entrant scraping today's listings cannot reconstruct it, and it is falsifiable and
specific — "Acme opened 47 roles in 90 days and closed 2" is a receipt, not a claim.

Rendering rule: prefer concrete counts with the company named over any adjective, badge,
or score. Specificity is what a competitor cannot copy. Where the counts are unavailable,
omit the block — never substitute a vaguer adjective to fill the space, and never infer.

### 6.1 Display normalization (new, required for public pages)

Live data is not presentation-clean. The 2026-08-09 sample returned
`company: "orange"` (lowercase) and `location: "WARSZAWA, POLAND"` (all caps). These are
tolerable inside a dense board but not on a page built to be indexed, shared into chat,
and rendered as a link preview — all-caps hurts click-through and reads as scraped.
Normalize title-case for company and location at the presentation layer only; do not
mutate stored data.

## 7. Closed / expired jobs

When a job is no longer active, keep the URL alive and render a closed state:

- Headline that the role is closed, plus when it was last seen active.
- **Keep** the company hiring-pattern block — this is the moment the ghost-jobs thesis is
  most persuasive, and it gives an arriving visitor something instead of a dead end.
- `noindex` on the page, and `validThrough` set in the JSON-LD so Google de-indexes the
  posting cleanly (Google requires expired postings be removed or marked).
- Link onward to the company page and to a relevant filtered board view.

Rejected: 410 (loses every shared link and bookmark), 301-to-board (Google treats mass
redirects to a generic page as soft-404s, which can damage the whole domain).

## 8. Metadata, JSON-LD, OG images

**Reuse the existing SEO primitives — do not write new ones.** Verified present in main:
`canonicalMetadata()` (`src/lib/seo/page-metadata.ts:15`) and, in `src/lib/seo/jsonld.ts`,
`serializeJsonLd()` (:64) alongside `buildFaqPageJsonLd` (:72), `buildArticleJsonLd` (:132),
`buildWebsiteJsonLd` (:149), `buildOrganizationJsonLd` (:166). The only new builder is
`buildJobPostingJsonLd()`, added to that same file next to its siblings.

**`generateMetadata`:** built through `canonicalMetadata()`, not hand-rolled — title
`"<Title> at <Company> — <Location> | Intervu"`, description leading with the integrity
verdict, canonical per §5, OG/Twitter card tags.

**JSON-LD:** one `JobPosting` object per page — `title`, `description`,
`hiringOrganization`, `jobLocation`, `datePosted` (`posted_at`), `validThrough`,
`employmentType`, `directApply: false` (we link out to `apply_url`). Emit only fields
actually present on the record; omit rather than invent. Ghost-flagged and closed jobs
are `noindex` and must not be submitted in the sitemap.

**OG images:** dynamic per-job via Next `ImageResponse` (`opengraph-image.tsx` in the
route folder). Without this a pasted link renders as a grey box, which forfeits the
sharing half of the bet. Card shows title, company, location, and the integrity verdict —
the verdict is the reason someone forwards the link. Must be cached (§9); generating an
image per crawler hit is a CPU sink.

## 9. Load, caching, rate limiting

This adds a **new public unauthenticated endpoint that hits Meilisearch and is designed
to attract crawler traffic**. Known constraints from prior sessions (unverified this
session, confirm before ship): Meili disk at ~92% with no swap, and prior 503 warmup
bursts under load.

Requirements:
- Cache job pages via ISR: `revalidate = 3600` (1h) for active jobs, `86400` (24h) for
  closed ones, which no longer change. A crawler must not cause one Meili query per hit.
- `getJobById` carries its own rate limit — removing the borrowed search limiter without
  replacing it would open a DoS/cost-amplification surface.
- Cache OG image responses.
- Sitemap generation must not scan the corpus synchronously on request.

## 10. Indexation policy

The ghost score doubles as the indexation filter:

- `likely_ghost` → `noindex`, excluded from sitemap. (Measured at ~0.12% of corpus, so
  this removes almost nothing — it exists for consistency with the product claim, not
  for index-size control.)
- Closed → `noindex`, excluded from sitemap.
- `unscored` (~12.5%) → renders normally for anyone arriving via a shared link, but
  `noindex` and excluded from sitemap: with no verdict, the page is pure duplicate content.
  This bucket shrinks as scoring coverage improves, so the rule is evaluated per-request
  from the record, never baked into a static list.
- `clear` / `caution` (~87.5%) → indexable, included in a **paginated sitemap index**.
  Prioritise `caution` and high-caution role families (§3) — those pages carry the most
  original content and therefore the best chance of ranking.

Submitting the entire corpus would exhaust crawl budget and emit thin-content signals
across the domain. Publishing pages we have flagged as probably fake would also
contradict the product's central claim. One filter, two purposes.

## 11. Testing

Test tooling in this repo (verified in `package.json`): **Playwright** for e2e
(`npm test`) and **Node's built-in runner via tsx** for unit tests
(`npx tsx --test tests/unit/<name>.test.ts`). There is no vitest. Add the new unit files
to a `test:*` script the way `test:agent` and `test:viewer` already do.

- Unit: UUID-tail parser (valid, malformed, uuid-in-slug-body, trailing junk); slug
  mismatch → 301; canonical origin derives from `SITE_URL`.
- Unit: JSON-LD builder omits absent fields and never emits placeholders.
- Integration: active job → 200 + indexable; closed job → 200 + `noindex` +
  `validThrough`; unknown id → 404; ghost-flagged → `noindex`.
- Per the standing "fix the class" rule, the parser test must cover a case other than the
  one that motivated it — specifically a slug whose *body* contains a UUID-like string.
- Confirm `getJobById` refactor does not change board existence-check behaviour at
  `page.tsx:1888`.

## 12. Out of scope

Browser extension; email/alerts (no email infra exists); the MCP connector story; the
parked Product Hunt launch; backfilling ghost scores; fixing the 21 remaining
`intervu.cc` references in `src/` (separate cleanup — includes the user-facing MCP URL in
`src/components/mock/CompletenessMock.tsx:44`, which should be checked independently since
a connector pointed at a redirecting domain is a live-user risk).

## 13. Risks

1. ~~`unscored` majority~~ — **retired**, measured at 12.5% (§3). Residual: coverage is
   sampled, not a census; re-check with the Meili facet query once a working host is to
   hand, since the sample cannot see how coverage varies across the long tail of the corpus.
2. **Domain age** — intervuhq.com is a recent migration, so it carries little accumulated
   authority; SEO returns will be slower than on an established domain. intervu.cc must
   keep 301-ing indefinitely or the equity transfer is lost.
3. **Duplicate content** — mitigated by §6 but not eliminated; ranking for scraped
   descriptions against the employer's own site is not guaranteed.
4. **Crawler load on Meili** (§9) — the failure mode is a 503 storm at exactly the moment
   Google is forming a quality judgement.
5. **Platform dependence** — this strategy makes Google the customer-owner. The integrity
   verdict is the hedge, since Google Jobs and the incumbent boards are structurally
   unable to ship it: employers are their paying customers.
6. **Meili index-settings drift** — `filterableAttributes` lives on the box, not in this
   repo, and a re-provision can silently drop `id` (this already happened once: the
   setting was code-only for six days while `id =` filters 400'd, per the comment in
   `src/lib/jobs/meilisearch.ts`). If it drops, every job page 404s or 500s at once, and
   Google is watching. The route must degrade the way `classifyExistenceCheck`
   (`src/lib/jobs/result-state.ts`) already does — serve a soft error, never assert a
   live role is gone — and this failure should page rather than fail silently.

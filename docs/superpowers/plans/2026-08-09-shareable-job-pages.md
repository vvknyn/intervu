# Shareable Job Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every job listing a server-rendered, indexable, shareable URL at
`/jobs/<slug>-<uuid>`, leading with intervu's original employer data.

**Architecture:** A new App Router server component fetches one job through a new
`getJobById` primitive (which must bypass the search path's closed-vacancy invariant),
renders the existing `JobDetail` under an employer-track-record block, and emits
`JobPosting` JSON-LD plus a dynamic OG image. Indexation is gated on `ghost_badge`.

**Tech Stack:** Next.js 16 App Router (async `params`), TypeScript, Meilisearch,
Playwright (e2e), `npx tsx --test` (unit). **No vitest in this repo.**

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-shareable-job-pages-design.md`. Read it first.
- Branch `feat/job-pages`, worktree `/Users/vivek/Antigravity/Code/intervu-job-pages`.
- Follow `~/.claude/skills/writing-lean-code`: SOLID at the seams, smallest complete diff,
  never gate by enumerating names, **no lying fallbacks**.
- Canonical origin ALWAYS from `SITE_URL` (`src/lib/seo/constants.ts`). Never a literal.
- Reuse existing primitives — `canonicalMetadata` (`src/lib/seo/page-metadata.ts`),
  `serializeJsonLd` (`src/lib/seo/jsonld.ts`), and the presentation helpers
  `locationText` / `salaryText` / `prettyEnum` / `decodeText` / `ghostMetaFor`
  (`src/lib/jobs/presentation.ts`). Do NOT write parallel versions.
- **Never invent data.** If a field is absent, omit the block. No adjective may substitute
  for a missing number.
- `PublicJob.company` is `string | null` and `location_country` is `string | string[] | null`.
  Handle both; do not assume.
- Unit tests run via `npx tsx --test <file>`; register new files in a `package.json`
  `test:*` script the way `test:agent` does.
- Commit after every task.

---

### Task 1: `getJobById` primitive

The existing by-id lookup (`searchJobsAction({ id, limit: 1 })`, used at
`src/app/jobs/page.tsx:1888`) is unusable for this feature for two reasons: it applies
per-IP *search* rate limiting and anonymous depth-capping that are meaningless for a
single-record read, and — critically — `JobSearchParams.id` composes through a baseline
`vacancy_status != "closed"` invariant in both backends, so **a closed job returns zero
hits**. The closed-state page (Task 4) requires fetching closed jobs.

Solution: read the document directly by Meilisearch primary key, which involves no filter
at all.

**Files:**
- Create: `src/lib/jobs/get-job.ts`
- Test: `tests/unit/get-job.test.ts`

**Interfaces:**
- Produces: `getJobById(id: string): Promise<PublicJob | null>` — returns the job
  regardless of `vacancy_status`; `null` when absent.

- [ ] **Step 1: Verify the Meili document endpoint is reachable with the configured key**

The repo uses `MEILISEARCH_SEARCH_KEY`. A search-scoped key may lack `documents.get`
permission. Verify before building on it:

```bash
# [verify-leg 1/1: can the configured key read a document by primary key?]
source /Users/vivek/Antigravity/Code/intervu-job-pages/.env.local 2>/dev/null
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $MEILISEARCH_SEARCH_KEY" \
  "$MEILISEARCH_HOST/indexes/jobs/documents/f7357d0c-fae4-4f2e-a850-c46d991efba3"
```

Expected: `200`. If `403`, the key lacks the permission — STOP and report; do not silently
fall back to the search path, because that path cannot see closed jobs and would produce a
404 for every expired listing (a lying fallback). The `.env.local` Meili host in this
worktree returned 502 on 2026-08-09, so this may need running against the prod host.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/get-job.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobDocumentUrl } from "../../src/lib/jobs/get-job.ts";

test("builds a document-by-primary-key URL, not a search URL", () => {
  const url = buildJobDocumentUrl("https://meili.example", "abc-123");
  assert.equal(url, "https://meili.example/indexes/jobs/documents/abc-123");
});

test("url-encodes the id so a hostile id cannot escape the path", () => {
  const url = buildJobDocumentUrl("https://meili.example", "a/../../keys");
  assert.ok(!url.includes("/../"), `id must be encoded, got ${url}`);
});

test("strips a trailing slash on the host rather than emitting a double slash", () => {
  const url = buildJobDocumentUrl("https://meili.example/", "abc");
  assert.equal(url, "https://meili.example/indexes/jobs/documents/abc");
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx tsx --test tests/unit/get-job.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/jobs/get-job.ts
import type { PublicJob } from "./types";

/** Meilisearch get-document-by-primary-key. No filter is involved, so unlike the
 *  search path this returns closed vacancies too — required by the closed-state page. */
export function buildJobDocumentUrl(host: string, id: string): string {
  return `${host.replace(/\/+$/, "")}/indexes/jobs/documents/${encodeURIComponent(id)}`;
}

export async function getJobById(id: string): Promise<PublicJob | null> {
  const host = process.env.MEILISEARCH_HOST;
  const key = process.env.MEILISEARCH_SEARCH_KEY;
  if (!host || !key) return null;

  const res = await fetch(buildJobDocumentUrl(host, id), {
    headers: { Authorization: `Bearer ${key}` },
    next: { revalidate: 3600 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`meili document fetch failed: ${res.status}`);
  return (await res.json()) as PublicJob;
}
```

Note the thrown error on non-404 failures: the caller must be able to distinguish "no such
job" from "backend is down". Returning `null` for both would let a Meili outage silently
de-index the entire corpus — the exact failure the spec's risk 6 describes.

On load protection (spec §9): the `next: { revalidate: 3600 }` on the fetch plus the
route's ISR is the primary defence — a repeat hit costs nothing. Deliberately do **not**
add a per-IP rate limit here the way the search action does: the highest-volume caller of
this route is Googlebot, and throttling it would sabotage the entire purpose of the
feature. If Meili load becomes a problem the correct levers are crawl-rate settings in
Search Console and the sitemap shard cap, not request rejection.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx tsx --test tests/unit/get-job.test.ts` → Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/get-job.ts tests/unit/get-job.test.ts
git commit -m "feat(jobs): getJobById reads by Meili primary key, sees closed vacancies"
```

---

### Task 2: Job slug encode + parse — and unify the EXISTING share URL

⚠️ **Read this before writing anything.** A share URL builder already exists:
`jobShareUrl(origin, jobId)` in `src/lib/jobs/share-url.ts`, shipped in #169. It returns
`/jobs?job=<id>` — the board's query param that reopens the detail sheet — and it has two
live callers:

- `src/components/jobs/JobDetail.tsx:272` — the `CopyJobLinkButton` a user clicks to share.
- `src/lib/agent/tools.ts:169` — `intervu_url` on every MCP `search_jobs` / `get_job` result.

That URL is shareable but **not indexable**: it is the board page with a query string, so it
carries no per-job metadata, no per-job OG image, and Google will fold it into `/jobs`.
Leaving it in place beside the new route would create two URLs per job, splitting link
equity and duplicating content.

**So this task changes one function and every caller inherits the fix** — the copy-link
button and every job link the MCP agent has ever emitted start pointing at real indexable
pages. That is the whole distribution win for a very small diff. Do not add a second
parallel builder.

**Files:**
- Create: `src/lib/jobs/job-slug.ts` (slug building + parsing)
- Modify: `src/lib/jobs/share-url.ts` (delegate to `jobPath`)
- Modify: `tests/unit/jobs-share-url.test.ts` (existing tests will need updating — read them
  first and preserve their intent)
- Test: `tests/unit/job-slug.test.ts`

**Interfaces:**
- Produces: `jobPath(job: Pick<PublicJob, "id" | "title" | "company">): string` →
  e.g. `/jobs/data-engineer-at-orange-f7357d0c-...`
- Produces: `parseJobSlug(slug: string): string | null` → the uuid, or null.
- Changes: `jobShareUrl(origin: string, job: Pick<PublicJob, "id"|"title"|"company">): string`
  → `${origin}${jobPath(job)}`. Both existing call sites have the full job object available,
  so update them to pass it rather than a bare id.

Backwards compatibility is preserved without extra work: `parseJobSlug` accepts a bare uuid,
so every `/jobs/<uuid>` link resolves and 301s to the canonical slug URL. Old
`/jobs?job=<id>` links keep working because `src/app/jobs/page.tsx:1066` still reads the
query param — leave that behaviour alone in this task.

Note `src/lib/boards/slug.ts` already owns *domain* slugs (`domainToSlug`) — a different
scheme for a different entity. Do not extend it; this is a separate concern.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-slug.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { jobPath, parseJobSlug } from "../../src/lib/jobs/job-slug.ts";

const UUID = "f7357d0c-fae4-4f2e-a850-c46d991efba3";

test("builds a readable path ending in the uuid", () => {
  assert.equal(
    jobPath({ id: UUID, title: "Data Engineer", company: "orange" }),
    `/jobs/data-engineer-at-orange-${UUID}`,
  );
});

test("omits the company segment when company is null", () => {
  assert.equal(jobPath({ id: UUID, title: "Data Engineer", company: null }), `/jobs/data-engineer-${UUID}`);
});

test("parses the uuid off the tail", () => {
  assert.equal(parseJobSlug(`data-engineer-at-orange-${UUID}`), UUID);
});

// The class of bug this guards, not just the instance: a title that itself
// contains a uuid-shaped run must not confuse the parser.
test("takes the TRAILING uuid when the slug body also contains one", () => {
  assert.equal(parseJobSlug(`migrate-${UUID}-job-${UUID}`), UUID);
});

test("rejects a slug with no uuid", () => {
  assert.equal(parseJobSlug("data-engineer-at-orange"), null);
});

test("rejects a bare uuid with trailing junk", () => {
  assert.equal(parseJobSlug(`${UUID}-`), null);
});

test("strips unicode and punctuation from titles", () => {
  assert.equal(
    jobPath({ id: UUID, title: "Señor C++ Dev (Remote!)", company: "Acme, Inc." }),
    `/jobs/senor-c-dev-remote-at-acme-inc-${UUID}`,
  );
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/unit/job-slug.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/jobs/job-slug.ts
import type { PublicJob } from "./types";

const UUID_TAIL = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function slugifyPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical path for a job. The slug is decorative; the trailing uuid is authoritative. */
export function jobPath(job: Pick<PublicJob, "id" | "title" | "company">): string {
  const parts = [slugifyPart(job.title)];
  const company = job.company ? slugifyPart(job.company) : "";
  if (company) parts.push("at", company);
  const slug = parts.filter(Boolean).join("-");
  return slug ? `/jobs/${slug}-${job.id}` : `/jobs/${job.id}`;
}

/** Extracts the authoritative uuid from a slug segment. Null when absent/malformed. */
export function parseJobSlug(slug: string): string | null {
  const match = UUID_TAIL.exec(slug);
  if (match) return match[1].toLowerCase();
  // A bare uuid with no descriptive prefix is still a legal, canonical-redirectable URL.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
    ? slug.toLowerCase()
    : null;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx tsx --test tests/unit/job-slug.test.ts` → Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/job-slug.ts tests/unit/job-slug.test.ts
git commit -m "feat(jobs): canonical job slug builder and uuid-tail parser"
```

---

### Task 3: `buildJobPostingJsonLd`

**Files:**
- Modify: `src/lib/seo/jsonld.ts` (append alongside `buildArticleJsonLd`)
- Test: `tests/unit/job-jsonld.test.ts`

**Interfaces:**
- Consumes: `SITE_URL`, `SITE_NAME` from `./constants`; `PublicJob` from `@/lib/jobs/types`.
- Produces: `buildJobPostingJsonLd(job: PublicJob, path: string): JobPostingJsonLd`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-jsonld.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobPostingJsonLd } from "../../src/lib/seo/jsonld.ts";

const base = {
  id: "f7357d0c-fae4-4f2e-a850-c46d991efba3",
  title: "Data Engineer",
  company: "Orange",
  description: "Build pipelines.",
  posted_at: "2026-08-09T04:15:36+00:00",
  location: "Warszawa, Poland",
  location_country: "Poland",
  employment_type: "full_time",
  vacancy_status: "active",
} as never;

test("emits a JobPosting with the required schema.org fields", () => {
  const ld = buildJobPostingJsonLd(base, "/jobs/data-engineer-at-orange-f7357d0c-fae4-4f2e-a850-c46d991efba3");
  assert.equal(ld["@type"], "JobPosting");
  assert.equal(ld.title, "Data Engineer");
  assert.equal(ld.hiringOrganization.name, "Orange");
  assert.equal(ld.datePosted, "2026-08-09T04:15:36+00:00");
  assert.equal(ld.directApply, false);
});

test("omits absent fields rather than emitting null or a placeholder", () => {
  const ld = buildJobPostingJsonLd({ ...base, description: null, posted_at: null } as never, "/jobs/x");
  assert.ok(!("description" in ld), "description must be omitted, not null");
  assert.ok(!("datePosted" in ld), "datePosted must be omitted, not null");
});

test("handles a multi-country posting (location_country as array)", () => {
  const ld = buildJobPostingJsonLd({ ...base, location_country: ["Poland", "Norway"] } as never, "/jobs/x");
  assert.ok(Array.isArray(ld.jobLocation));
  assert.equal(ld.jobLocation.length, 2);
});

test("sets validThrough on a closed vacancy so Google de-indexes it", () => {
  const ld = buildJobPostingJsonLd(
    { ...base, vacancy_status: "closed", updated_at: "2026-08-01T00:00:00+00:00" } as never,
    "/jobs/x",
  );
  assert.equal(ld.validThrough, "2026-08-01T00:00:00+00:00");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/unit/job-jsonld.test.ts` → Expected: FAIL, export missing.

- [ ] **Step 3: Implement — append to `src/lib/seo/jsonld.ts`**

```ts
import type { PublicJob } from "@/lib/jobs/types";

interface JobPostingLocation {
  "@type": "Place";
  address: { "@type": "PostalAddress"; addressCountry?: string; addressLocality?: string };
}

export interface JobPostingJsonLd {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  url: string;
  directApply: false;
  hiringOrganization: { "@type": "Organization"; name: string };
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  jobLocation?: JobPostingLocation[];
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  contract: "CONTRACTOR",
};

function toPlaces(job: PublicJob): JobPostingLocation[] | undefined {
  const countries = Array.isArray(job.location_country)
    ? job.location_country
    : job.location_country
      ? [job.location_country]
      : [];
  if (countries.length === 0) return undefined;
  return countries.map((country) => ({
    "@type": "Place" as const,
    address: {
      "@type": "PostalAddress" as const,
      addressCountry: country,
      ...(job.location_city ? { addressLocality: job.location_city } : {}),
    },
  }));
}

/** Every field is omitted when absent — never null, never a placeholder. `directApply`
 *  is false because applying always leaves for the employer's own ATS. */
export function buildJobPostingJsonLd(job: PublicJob, path: string): JobPostingJsonLd {
  const places = toPlaces(job);
  const employmentType = EMPLOYMENT_TYPE_MAP[job.employment_type];
  const closed = job.vacancy_status === "closed";
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    url: `${SITE_URL}${path}`,
    directApply: false,
    hiringOrganization: { "@type": "Organization", name: job.company ?? "Unlisted employer" },
    ...(job.description ? { description: job.description } : {}),
    ...(job.posted_at ? { datePosted: job.posted_at } : {}),
    ...(closed && job.updated_at ? { validThrough: job.updated_at } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(places ? { jobLocation: places } : {}),
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx tsx --test tests/unit/job-jsonld.test.ts` → Expected: PASS (4 tests).

- [ ] **Step 5: Register unit tests and commit**

Add to `package.json` scripts:
```json
"test:jobpage": "npx tsx --test tests/unit/get-job.test.ts tests/unit/job-slug.test.ts tests/unit/job-jsonld.test.ts"
```

```bash
git add src/lib/seo/jsonld.ts tests/unit/job-jsonld.test.ts package.json
git commit -m "feat(seo): JobPosting JSON-LD builder with absent-field omission"
```

---

### Task 4: The `/jobs/[slug]` route

**Files:**
- Create: `src/app/jobs/[slug]/page.tsx`
- Create: `src/components/jobs/EmployerTrackRecord.tsx`
- Test: `tests/e2e/job-page.spec.ts`

**Interfaces:**
- Consumes: `getJobById` (Task 1), `jobPath` / `parseJobSlug` (Task 2),
  `buildJobPostingJsonLd` (Task 3), `canonicalMetadata`, `serializeJsonLd`, `JobDetail`.

**Content order is mandatory (spec §6):** `<h1>` title+company → employer track record →
integrity verdict → exposure → location/description/apply. Every block of original content
precedes the scraped description, because the description is duplicate content Google
attributes to the employer.

- [ ] **Step 1: Build the employer track-record component**

```tsx
// src/components/jobs/EmployerTrackRecord.tsx
import Link from "next/link";
import { domainToSlug } from "@/lib/boards/slug";
import type { PublicJob } from "@/lib/jobs/types";

/** Concrete counts only. When the aggregates are absent the block does not render —
 *  a vaguer adjective must never stand in for a missing number (spec §6.2). */
export function EmployerTrackRecord({ job }: { job: PublicJob }) {
  const opened = job.company_opened_90d;
  const closed = job.company_closed_90d;
  if (opened == null || closed == null || !job.company) return null;

  const href = job.company_domain ? `/co/${domainToSlug(job.company_domain)}` : null;
  const body = (
    <>
      {job.company} opened {opened} {opened === 1 ? "role" : "roles"} in the last 90 days and
      closed {closed}.
    </>
  );

  return (
    <section data-testid="employer-track-record">
      <p>{body}</p>
      {href && <Link href={href}>See {job.company}&rsquo;s full hiring record</Link>}
    </section>
  );
}
```

- [ ] **Step 2: Build the route**

```tsx
// src/app/jobs/[slug]/page.tsx
import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { JobDetail } from "@/components/jobs/JobDetail";
import { EmployerTrackRecord } from "@/components/jobs/EmployerTrackRecord";
import { getJobById } from "@/lib/jobs/get-job";
import { jobPath, parseJobSlug } from "@/lib/jobs/job-slug";
import { locationText } from "@/lib/jobs/presentation";
import { buildJobPostingJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

export const revalidate = 3600;

// `cache()` so generateMetadata and the page body share ONE fetch per request
// instead of hitting Meili twice for every crawler visit.
const load = cache(async (slug: string) => {
  const id = parseJobSlug(slug);
  if (!id) return null;
  const job = await getJobById(id);
  return job ? { job, path: jobPath(job) } : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) return { title: "Job not found", robots: { index: false, follow: false } };

  const { job, path } = found;
  const where = locationText(job);
  const title = `${job.title}${job.company ? ` at ${job.company}` : ""}${where ? ` — ${where}` : ""} | Intervu`;
  const description =
    job.company_opened_90d != null && job.company_closed_90d != null && job.company
      ? `${job.company} opened ${job.company_opened_90d} roles in 90 days and closed ${job.company_closed_90d}. See the hiring record before you apply.`
      : `${job.title}${job.company ? ` at ${job.company}` : ""} — checked against companies' own career pages.`;

  const indexable = job.vacancy_status !== "closed" && job.ghost_badge !== "likely_ghost" && job.ghost_badge !== "unscored";

  return {
    title,
    description,
    ...canonicalMetadata(path, title, description),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) notFound();

  const { job, path } = found;
  // Slug is decorative; if it drifted, send crawlers and humans to the one canonical URL.
  if (`/jobs/${slug}` !== path) permanentRedirect(path);

  const jsonLd = buildJobPostingJsonLd(job, path);
  const closed = job.vacancy_status === "closed";

  return (
    <main data-testid="job-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <h1>
        {job.title}
        {job.company ? ` at ${job.company}` : ""}
      </h1>
      {closed && (
        <p data-testid="job-closed-notice">
          This role is closed. It was last seen active on{" "}
          {job.updated_at ? new Date(job.updated_at).toISOString().slice(0, 10) : "an earlier date"}.
        </p>
      )}
      <EmployerTrackRecord job={job} />
      <JobDetail job={job} />
    </main>
  );
}
```

Note: `JobDetail` is a client component taking a full `PublicJob` — passing the
server-fetched object across the boundary is the intended usage, matching how
`src/app/jobs/page.tsx` already renders it. If its props require additional handlers,
supply the minimum and do NOT fork a second detail component.

- [ ] **Step 3: Normalize display casing (spec §6.1)**

Live data is not presentation-clean: a 2026-08-09 sample returned `company: "orange"`
(lowercase) and `location: "WARSZAWA, POLAND"` (all caps). All-caps text depresses
click-through and reads as scraped — unacceptable on a page built to be indexed and
shared.

First check whether `locationText` / `decodeText` in `src/lib/jobs/presentation.ts`
already handle casing. If they do, use them and skip this step. If they do not, add a
`titleCaseDisplay(value: string): string` helper **to that same file** (never a second
copy in the route) that title-cases a string only when it is entirely upper- or
lower-case, leaving deliberately-cased names like "eBay" or "IBM" untouched:

```ts
/** Repairs scraped ALL-CAPS / all-lowercase text for public display. Mixed-case
 *  input is left alone, so intentional casing (eBay, IBM) survives. */
export function titleCaseDisplay(value: string): string {
  const hasMixedCase = value !== value.toLowerCase() && value !== value.toUpperCase();
  if (hasMixedCase) return value;
  return value.replace(/[\p{L}\p{N}']+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
```

Apply it to company and location at render time only. **Never mutate stored data** — this
is presentation, and the underlying record must keep what the employer actually published.

Test it in `tests/unit/job-slug.test.ts`'s sibling or a new `presentation.test.ts`,
including a mixed-case case (`"eBay"` → `"eBay"`) as the class-covering case.

- [ ] **Step 4: Write the e2e test**

```ts
// tests/e2e/job-page.spec.ts
import { expect, test } from "@playwright/test";

// A real active job id must be sourced at run time from the board rather than
// hardcoded, because listings expire and a pinned id makes the suite rot.
async function firstJobPath(page): Promise<string> {
  await page.goto("/jobs");
  const link = page.locator('a[href^="/jobs/"]').first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href")) as string;
}

test("a job page renders server-side with JobPosting JSON-LD", async ({ page }) => {
  const path = await firstJobPath(page);
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(ld).toContain('"@type":"JobPosting"');
  await expect(page.getByTestId("job-page")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
});

test("canonical points at the current site origin, never the retired domain", async ({ page }) => {
  const path = await firstJobPath(page);
  await page.goto(path);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).not.toContain("intervu.cc");
});

test("a malformed slug 404s instead of rendering an empty shell", async ({ page }) => {
  const res = await page.goto("/jobs/not-a-real-job-slug");
  expect(res?.status()).toBe(404);
});
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/e2e/job-page.spec.ts`
Expected: PASS. If the suite cannot reach Meili, report it — do not weaken assertions.

- [ ] **Step 6: Commit**

```bash
git add src/app/jobs/\[slug\]/page.tsx src/components/jobs/EmployerTrackRecord.tsx src/lib/jobs/presentation.ts tests/e2e/job-page.spec.ts
git commit -m "feat(jobs): server-rendered job pages with JobPosting JSON-LD and closed state"
```

---

### Task 5: Dynamic OG image

Without this a shared link renders as a grey box, forfeiting the sharing half of the bet.

**Files:**
- Create: `src/app/jobs/[slug]/opengraph-image.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/jobs/[slug]/opengraph-image.tsx
import { ImageResponse } from "next/og";
import { getJobById } from "@/lib/jobs/get-job";
import { parseJobSlug } from "@/lib/jobs/job-slug";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseJobSlug(slug);
  const job = id ? await getJobById(id) : null;

  const headline = job ? job.title : "Intervu";
  const sub =
    job && job.company_opened_90d != null && job.company_closed_90d != null && job.company
      ? `${job.company} · opened ${job.company_opened_90d} roles in 90d, closed ${job.company_closed_90d}`
      : (job?.company ?? "Live jobs, checked against companies' own career pages");

  return new ImageResponse(
    (
      <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0b0b0c", color: "#fafafa", padding: 72 }}>
        <div style={{ fontSize: 60, lineHeight: 1.1 }}>{headline}</div>
        <div style={{ fontSize: 30, marginTop: 24, color: "#a1a1aa" }}>{sub}</div>
      </div>
    ),
    size,
  );
}
```

The subtitle carries the employer counts because that number is the reason a person
forwards the link. Falls back to the company name only — never to an invented statistic.

- [ ] **Step 2: Verify the image actually renders**

Run `npm run dev`, then:
```bash
curl -s -o /tmp/og.png -w "%{http_code} %{content_type}\n" "http://localhost:3000/jobs/<real-slug>/opengraph-image"
```
Expected: `200 image/png`. **Then open `/tmp/og.png` and look at it** — a 200 with a
correct content-type does not prove the text rendered or that it isn't clipped
(meta-cog L-105: stripped output is not ground truth for visual claims).

- [ ] **Step 3: Commit**

```bash
git add src/app/jobs/\[slug\]/opengraph-image.tsx
git commit -m "feat(jobs): per-job OG image leading with the employer hiring record"
```

---

### Task 6: Sitemap inclusion + indexation gate

**Files:**
- Modify: `src/app/sitemap.ts`
- Test: `tests/unit/job-indexability.test.ts`

**Interfaces:**
- Produces: `isJobIndexable(job: Pick<PublicJob, "vacancy_status" | "ghost_badge">): boolean`
  in `src/lib/jobs/job-slug.ts` (co-located with the other URL concerns).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-indexability.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isJobIndexable } from "../../src/lib/jobs/job-slug.ts";

test("indexes screened jobs", () => {
  assert.equal(isJobIndexable({ vacancy_status: "active", ghost_badge: "clear" }), true);
  assert.equal(isJobIndexable({ vacancy_status: "active", ghost_badge: "caution" }), true);
});

test("excludes unscored jobs — with no verdict the page is pure duplicate content", () => {
  assert.equal(isJobIndexable({ vacancy_status: "active", ghost_badge: "unscored" }), false);
});

test("excludes flagged and closed jobs", () => {
  assert.equal(isJobIndexable({ vacancy_status: "active", ghost_badge: "likely_ghost" }), false);
  assert.equal(isJobIndexable({ vacancy_status: "closed", ghost_badge: "clear" }), false);
});
```

- [ ] **Step 2: Implement in `src/lib/jobs/job-slug.ts`**

```ts
/** Gate for both the sitemap and the page's robots meta, so the two can never disagree. */
export function isJobIndexable(
  job: Pick<PublicJob, "vacancy_status" | "ghost_badge">,
): boolean {
  if (job.vacancy_status === "closed") return false;
  return job.ghost_badge === "clear" || job.ghost_badge === "caution";
}
```

Then refactor `generateMetadata` in Task 4's route to call `isJobIndexable(job)` instead of
its inline condition — one gate, two consumers.

- [ ] **Step 3: Run the tests**

Run: `npx tsx --test tests/unit/job-indexability.test.ts` → Expected: PASS (4 tests).

- [ ] **Step 4: Add a sharded job sitemap**

Create `src/app/jobs/sitemap.ts` (leave the existing static `src/app/sitemap.ts` alone —
different responsibility, different change cadence):

```ts
import type { MetadataRoute } from "next";
import { searchJobsAction } from "@/actions/jobs";
import { jobPath } from "@/lib/jobs/job-slug";
import { SITE_URL } from "@/lib/seo/constants";

const PAGE = 1000; // Meili page size
const SHARD = 50_000; // sitemap protocol hard limit per file
const SHARDS = 20; // deliberate cap — see the log line below

export async function generateSitemaps() {
  return Array.from({ length: SHARDS }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  const base = id * SHARD;

  for (let offset = 0; offset < SHARD; offset += PAGE) {
    const res = await searchJobsAction({ limit: PAGE, offset: base + offset });
    if (!res.hits.length) break;
    for (const job of res.hits) {
      // The sitemap and the page's robots meta share one gate so they can never disagree.
      if (!isJobIndexable(job)) continue;
      entries.push({
        url: `${SITE_URL}${jobPath(job)}`,
        lastModified: job.updated_at ?? undefined,
      });
    }
  }

  console.info(
    `[sitemap] shard ${id}: ${entries.length} indexable URLs; corpus coverage is capped at ` +
      `${SHARDS * SHARD} jobs by design — the remainder is deliberately unlisted, not missing.`,
  );
  return entries;
}
```

Two things this deliberately does. It **logs the cap** rather than truncating silently — a
partial sitemap otherwise reads as "we covered everything" when it did not. And it reuses
`isJobIndexable`, so a job can never be `noindex` on the page yet advertised in the sitemap.

⚠️ Verify before relying on it: `searchJobsAction` applies anonymous **depth capping**
(`resolveDepthCap`, `src/actions/jobs.ts`), which will very likely refuse deep offsets and
silently return an empty gated result. If it does, this loop stops early and quietly
under-reports. Confirm the actual behaviour at a large offset first; if it caps, the sitemap
needs its own uncapped enumeration path rather than borrowing the search action — and if
that is not available in this task's scope, **stop and report** instead of shipping a
sitemap that lies about coverage.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/job-slug.ts src/app/sitemap.ts tests/unit/job-indexability.test.ts
git commit -m "feat(seo): index only screened, open jobs; shard the job sitemap"
```

---

### Task 7: Link the board to the new pages

Nothing links to job pages yet, so neither crawlers nor humans can reach them.

**Files:**
- Modify: `src/app/jobs/page.tsx`

- [ ] **Step 1:** Wrap each result row's title in a real `<a href={jobPath(job)}>`, keeping
  the existing sheet/panel behaviour for in-page clicks. A real anchor is required for
  crawl discovery and for "open in new tab" / copy-link, which is how sharing actually
  happens. Do not replace the panel interaction — add the href beneath it.

- [ ] **Step 2:** Verify crawlability without JS:

```bash
curl -s https://localhost:3000/jobs | grep -c 'href="/jobs/'
```
Expected: greater than 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/jobs/page.tsx
git commit -m "feat(jobs): board rows link to canonical job URLs"
```

---

## Verification before opening a PR

- [ ] `npm run test:jobpage` — all unit tests pass.
- [ ] `npx playwright test tests/e2e/job-page.spec.ts` — passes.
- [ ] `npm run lint` and `npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds (catches Next-specific route errors the tests miss).
- [ ] OG image visually inspected, not just status-checked.
- [ ] Validate one rendered page's JSON-LD in Google's Rich Results Test.
- [ ] Confirm no emitted canonical or OG URL contains `intervu.cc`.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { CompanyFollowChannelProvider } from "@/components/companies/CompanyFollowChannelProvider";
import { CompanyCadenceStrip } from "@/components/company/CompanyCadenceStrip";
import { CompanyChangeEventTeaser } from "@/components/company/CompanyChangeEventTeaser";
import { CompanyChangeEvents } from "@/components/company/CompanyChangeEvents";
import { CompanyExhaustGate, type ExhaustGateTeaser } from "@/components/company/CompanyExhaustGate";
import { CompanyFactRow } from "@/components/company/CompanyFactRow";
import { CompanyFilingsBand } from "@/components/company/CompanyFilingsBand";
import { CompanyIntegrityBand } from "@/components/company/CompanyIntegrityBand";
import { CompanyIntelGate } from "@/components/company/CompanyIntelGate";
import { staleShareText } from "@/components/company/company-page-copy";
import { CompanyIntelligenceGrid } from "@/components/company/CompanyIntelligenceGrid";
import { CompanyRoleSearch } from "@/components/company/CompanyRoleSearch";
import { CompanyTechStackBand } from "@/components/company/CompanyTechStackBand";
import { CompanyVerdictBand } from "@/components/company/CompanyVerdictBand";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { chipVariants } from "@/components/ui/chip-variants";
import { cn } from "@/lib/utils";
import type { CompanyChangeEvent } from "@/lib/companies/types";
import { humanizeProjectorHeadline } from "@/lib/companies/events";
import { getCompanyPageData } from "@/lib/companies/get-company";
import {
  buildCompanyFacts,
  buildCompanyHiringAnswer,
  buildCompanyJobsUrl,
  buildCompanyPageMetadata,
  openCountText,
  sampleCoversAllRoles,
} from "@/lib/companies/presentation";
import { buildCompanyFaqItems, buildCompanyOrganizationJsonLd, buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  if (!data) return { title: "Company not found", robots: { index: false, follow: false } };
  return buildCompanyPageMetadata(data);
}

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCompanyPageData(slug);
  if (!data) notFound();
  // One clock read for the whole page, taken here rather than inside JSX so
  // every staleness decision below is measured against a single instant.
  // The purity rule fires on any Date.now() in a component body and can't
  // see that this is an async Server Component — rendered once, per request,
  // on the server, where a clock read is neither unstable nor re-entrant.
  // Same pattern and same suppression rationale as CompanyRolesList's `now`
  // prop on /companies/[slug].
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // See `buildCompanyJobsUrl`'s docblock (lib/companies/presentation.ts) for
  // why this can't be a hand-built `?q=...` string.
  const jobsSearchUrl = buildCompanyJobsUrl(data);
  const ghostPctIsCompanyWide = sampleCoversAllRoles(data);
  const hiring = buildCompanyHiringAnswer(data, data.nowMs);
  // Quiet fact row under the hiring answer — domain, hiring geos, remote
  // share. See `buildCompanyFacts`'s own doc for why each part can be null.
  const facts = buildCompanyFacts(data);
  // "9 of the 68 roles tracked here may no longer be live" — see company-page-copy.ts for
  // why the count is always derivable from `data.ghostFlaggedPct` (the
  // CompanyPageData field behind the gated rail's own KPI tile — unrelated
  // to the FAQPage structured data above, which never states this stat) and
  // doesn't need the company-wide/sample split above.
  const staleShare = staleShareText(data);
  const faqJsonLd = buildFaqPageJsonLd(
    buildCompanyFaqItems({
      companyName: data.name,
      // The same sentence the body renders below — see `CompanyFaqInput`.
      hiringAnswer: humanizeProjectorHeadline(hiring.headline),
    }),
  );
  // Same array-of-graphs convention as the root layout's own JSON-LD
  // (app/layout.tsx) — one script tag, not one per graph. Organization is
  // unconditional (domain, hence a logo URL, always exists here); FAQPage
  // drops out when `buildFaqPageJsonLd` has nothing valid to say.
  const companyJsonLd = [
    buildCompanyOrganizationJsonLd({
      name: data.name,
      domain: data.domain,
      knowsAbout: data.intelligence?.techStack?.languages,
    }),
    ...(faqJsonLd ? [faqJsonLd] : []),
  ];

  // Header chips (Band 1 extension) — each one is a fact from the box-PG
  // profile row; a missing field just doesn't produce a chip (Rule 2). Never
  // fed into JSON-LD/meta (Section 6 of the contract): these are UI-only.
  const profile = data.exhaust?.profile?.data ?? null;
  const headerChips = profile
    ? [
        profile.atsHint,
        profile.nbEmployees ? `≈${profile.nbEmployees} people` : null,
        profile.yearFounded ? `est. ${profile.yearFounded}` : null,
        profile.organizationType,
        profile.parentCompany ? `part of ${profile.parentCompany}` : null,
      ].filter((c): c is string => Boolean(c))
    : [];

  // Exhaust PG history, same `CompanyChangeEvent` shape as the projector
  // list. Fallback only — never a second "Recent changes" mount. Projector
  // rows carry evidence (outlook / score); exhaust titles do not.
  const exhaustChangeHistory: CompanyChangeEvent[] = (data.exhaust?.changeHistory?.data ?? [])
    .filter((e) => e.title)
    .map((e) => ({
      event_type: e.eventType,
      direction: e.direction === "improving" || e.direction === "declining" ? e.direction : "neutral",
      headline: e.title as string,
      occurred_at: e.occurredAt,
      confidence: e.confidence,
    }));
  const changeEvents =
    data.changeEvents.length > 0 ? data.changeEvents : exhaustChangeHistory;

  // Gate teasers — real counts from the same exhaust sections the unlocked
  // bands below render from, never fabricated (design call DC3). A section
  // that resolved to null (query failed, or genuinely no rows) simply
  // contributes no teaser row instead of a fake "0".
  const integrityCount = data.exhaust?.integrity?.data.closedReasonCounts.reduce((s, r) => s + r.count, 0) ?? null;
  const filingsCount =
    (data.exhaust?.secListing ? 1 : 0) + (data.exhaust?.funding?.data.formDCount ? 1 : 0) +
      (data.exhaust?.govContracts?.data.awardCount ?? 0) +
      (data.exhaust?.warnNotices?.data.noticeCount ?? 0) +
      (data.exhaust?.h1bLca ? 1 : 0) || null;
  const exhaustGateTeasers: ExhaustGateTeaser[] = [
    data.exhaust?.integrity && integrityCount
      ? {
          title: "Listing integrity",
          description: "How honest their postings are: reposts, resurrections, how roles actually close.",
          count: `${integrityCount} closings on record`,
        }
      : null,
    // Change history lives once, behind CompanyIntelGate — not a second
    // exhaust-band teaser that unlocks a duplicate "Recent changes".
    data.exhaust?.techStack
      ? {
          title: "Hiring infrastructure",
          description: "What their site runs on, and how it's built.",
          count: null,
        }
      : null,
    filingsCount
      ? {
          title: "Filings & records",
          description: "SEC filings, funding rounds, federal contracts, WARN layoffs, and H-1B approvals — the paper trail.",
          count: `${filingsCount} record${filingsCount === 1 ? "" : "s"}`,
        }
      : null,
  ].filter((t): t is ExhaustGateTeaser => t !== null);

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(companyJsonLd) }}
      />
      <div className="border-b border-border px-4 sm:px-8 xl:px-10">
        <nav className="mx-auto flex h-10 max-w-6xl items-center text-sm text-muted-foreground xl:max-w-7xl">
          <Link href="/jobs" className="text-brand hover:underline">
            Find jobs
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          {data.name}
        </nav>
      </div>

      <CompanyFollowChannelProvider domain={data.domain} displayName={data.name}>
      <div data-testid="company-page" className="mx-auto max-w-6xl xl:max-w-7xl px-4 py-4 pb-8 sm:px-8 sm:pb-10 xl:px-10">
        {/* Identity header: name, the "is X hiring?" answer folded straight
            into the subtitle line (no separate boxed KPI card), and Follow
            as the page's one primary action — inverted-ink treatment via
            `variant="primary"` (maps to Button's `default` variant). Blue
            (`variant="brand"`, used below for the roles list's "View all"
            button) is for interactive accents, never the primary CTA. */}
        <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <CompanyLogo domain={data.domain} name={data.name} size="md" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-semibold sm:text-2xl">{data.name}</h1>
              {data.oneLiner && (
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {data.oneLiner}
                </p>
              )}
              <p className="mt-2 flex items-center gap-2 text-sm leading-snug text-foreground">
                {hiring.hasOpenRoles && (
                  <span className="h-2 w-2 shrink-0 rounded-none bg-live" aria-hidden />
                )}
                {humanizeProjectorHeadline(hiring.headline)}
              </p>
              {/* Facts row — compact chips matching the jobs toolbar / SERP
                  meta language. Domain stays a real external link; missing
                  facts stay silent (Rule 2). */}
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  <a
                    key="domain"
                    href={`https://${facts.domain}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-brand hover:underline"
                  >
                    {facts.domain}
                  </a>,
                  profile?.hqCountry,
                  facts.hiringGeos,
                  facts.remoteShare,
                  data.stage,
                  ...headerChips,
                ]
                  .filter((item): item is string | ReactNode => Boolean(item))
                  .map((item, index) => (
                    <span
                      key={typeof item === "string" ? item : `chip-${index}`}
                      className={cn(
                        chipVariants({ active: false }),
                        "h-auto min-h-7 px-2.5 py-1 text-foreground",
                      )}
                    >
                      {item}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <CompanyFollowControl
            key={data.domain}
            domain={data.domain}
            slug={data.slug}
            displayName={data.name}
            variant="primary"
            idleLabel="Follow this company"
            className="shrink-0 self-start items-end text-right"
          />
        </header>

        {/* Bands 2-3 — the Hiring Record's public, full-width bands: the
            health-review verdict and the posting-cadence strip (the page's
            signature band, public per design call DC1). Both drop cleanly
            when the exhaust module has nothing for this domain. */}
        {data.exhaust && (
          <div className="mb-4 space-y-4">
            <CompanyVerdictBand health={data.exhaust.health} nowMs={data.nowMs} />
            <CompanyCadenceStrip cadence={data.exhaust.cadence} />
          </div>
        )}

        {/* Two-column body below the header: roles + gated change/public
            content in the main column, the hiring record and list health in
            a narrower rail — collapses to one stacked column under `lg`. */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0">
            {/* Open roles are the reason a job seeker landed here, so the
                roles list is the first thing under the header, not four KPI
                tiles and an intelligence suite. */}
            <CompanyRoleSearch
              jobs={data.jobs}
              companyDomain={data.domain}
              companySlug={data.slug}
              companyName={data.name}
              openCountLabel={openCountText(data)}
              searchesPartialWindow={!ghostPctIsCompanyWide}
              jobsSearchUrl={jobsSearchUrl}
              now={now}
            />

            {/* Quiet secondary content — hiring changes, tech stack, and
                news — never ahead of the roles a visitor came here for. */}
            <div data-testid="company-secondary" className="mt-4 space-y-4">
              <CompanyChangeEventTeaser event={data.changeEvents[0] ?? null} />

              <CompanyIntelGate domain={data.domain} slug={data.slug} displayName={data.name}>
                <CompanyChangeEvents events={changeEvents} companyName={data.name} />
                <CompanyIntelligenceGrid intelligence={data.intelligence} companyName={data.name} />
              </CompanyIntelGate>
            </div>
          </div>

          {/* Rail: the hiring record and list health, named and gated —
              same follower-only boundary as the main column's intel gate
              (Section 05: "the proposal changes only the locked state's
              form ... never which facts are locked"), one lock row shared by
              both named boxes, no button (the header's Follow control above
              is this page's one primary CTA). */}
          <aside className="space-y-4">
            <CompanyIntelGate
              domain={data.domain}
              slug={data.slug}
              displayName={data.name}
              testId="company-intel-gate-record"
              description={`The hiring record and list health for ${data.name} — visible once you follow.`}
              showFollowButton={false}
            >
              <div className="space-y-4">
                {/* Plain-language hiring record — same figures the old
                    "Hiring activity" section drew from, now its own named
                    rail box instead of a shared block with the intel grid. */}
                <section data-testid="company-hiring-activity" className="border border-border bg-card p-4">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    The hiring record — last 90 days
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-foreground">{hiring.trackRecord}</p>
                  {hiring.freshness && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hiring.freshness}</p>
                  )}
                  {/* The 90-day provenance note describes this track record
                      specifically, and that is the one thing this page cannot
                      show today (`hasTrackRecord` is false for every employer
                      until the `company_*` aggregate sync lands). Printed
                      under an assumed 90-day window it asserts an observation
                      that was never made — so it renders only when there is a
                      track record for it to describe. */}
                  {data.hasTrackRecord && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Metrics derived from observed job postings over 90 days — not fundraising data,
                      employee reviews, or third-party valuations.
                    </p>
                  )}
                </section>

                {/* List health — the ghost-flagged share restated as a count
                    instead of a bare, jargon-labelled percentage tile. */}
                {staleShare && (
                  <section className="border border-border bg-card p-4">
                    <h2 className="text-xs font-semibold text-muted-foreground">
                      List health
                    </h2>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{staleShare}</p>
                  </section>
                )}
              </div>
            </CompanyIntelGate>
          </aside>
        </div>

        {/* Band 5 — "On the record": enrichment facts, public per D1. Drops
            below two cells (CompanyFactRow's own rule). */}
        {data.exhaust && (
          <div className="mt-4">
            <CompanyFactRow exhaust={data.exhaust} />
          </div>
        )}

        {/* Bands 6/8/9 — listing integrity, hiring infrastructure, filings.
            Change history is not here: one CompanyChangeEvents lives in
            CompanyIntelGate above. Signed-in only; signed-out visitors see
            real-count teasers, never blurred content. */}
        {data.exhaust && exhaustGateTeasers.length > 0 && (
          <div className="mt-4">
            <CompanyExhaustGate slug={data.slug} displayName={data.name} teasers={exhaustGateTeasers}>
              <div className="space-y-4">
                <CompanyIntegrityBand integrity={data.exhaust.integrity} />
                <CompanyTechStackBand techStack={data.exhaust.techStack} />
                <CompanyFilingsBand exhaust={data.exhaust} />
              </div>
            </CompanyExhaustGate>
          </div>
        )}
      </div>
      </CompanyFollowChannelProvider>
    </div>
  );
}

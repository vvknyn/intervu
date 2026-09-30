import Link from "next/link";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { CompanyFollowChannelProvider } from "@/components/companies/CompanyFollowChannelProvider";
import { cadenceStripHasContent, CompanyCadenceStrip } from "@/components/company/CompanyCadenceStrip";
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
import { CompanyVerdictBand, verdictBandHasContent } from "@/components/company/CompanyVerdictBand";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { DotSeparated } from "@/components/ui/dot-separated";
import { PageTitle } from "@/components/ui/heading";
import { humanizeProjectorHeadline } from "@/lib/companies/events";
import type { CompanyChangeEvent, CompanyPageData } from "@/lib/companies/types";
import { companyUnlockStep } from "@/lib/company/unlock-step";
import { cn } from "@/lib/utils";
import {
  buildCompanyFacts,
  buildCompanyHiringAnswer,
  buildCompanyJobsUrl,
  buildCompanyRoleStats,
  openCountText,
  sampleCoversAllRoles,
} from "@/lib/companies/presentation";

/**
 * Everything on `/co/[slug]` below the breadcrumb, from data already fetched.
 * Split from the route (app/co/[slug]/page.tsx, which fetches and frames it)
 * so a fixture page can render the same composition on a real server
 * without the search index or the box database (see /mock/company-page).
 *
 * The first screen is the roles. Company pages are nearly always a visit's
 * first page and most visitors never scroll (PostHog, 30 days to
 * 2026-09-29), so the header's answer, the stat row and the roles list come
 * first; the posting rhythm and the hiring review sit in the rail beside
 * them as evidence, and everything else follows.
 */
export function CompanyPageBody({
  data,
  signedIn,
  now,
}: {
  data: CompanyPageData;
  /** From `getServerUser()` in the route; decides which gate card shows. */
  signedIn: boolean;
  /** The route's one clock read (see page.tsx). */
  now: number;
}) {
  // An anonymous visitor already gets a single combined ask from
  // `CompanyExhaustGate`'s sign-in card below (full record + hiring
  // history); the main column's `CompanyIntelGate` card would stack a
  // second, near-duplicate one, so it renders nothing instead. `following`
  // is never known here — that's client-only state — so this only answers
  // "if not yet following, what's the next step?".
  const mainIntelGateFallback =
    companyUnlockStep({ signedIn, following: false }) === "sign-in" ? null : undefined;

  // See `buildCompanyJobsUrl`'s docblock (lib/companies/presentation.ts) for
  // why this can't be a hand-built `?q=...` string.
  const jobsSearchUrl = buildCompanyJobsUrl(data);
  const ghostPctIsCompanyWide = sampleCoversAllRoles(data);
  const hiring = buildCompanyHiringAnswer(data, data.nowMs);
  // Quiet fact row under the hiring answer — domain, hiring geos, remote
  // share. See `buildCompanyFacts`'s own doc for why each part can be null.
  const facts = buildCompanyFacts(data);
  const roleStats = buildCompanyRoleStats(data, data.nowMs);
  // The rail sits beside the roles only when it has something public to
  // show. Without the posting chart or a review (no box data for this
  // employer) it would be an empty 320px column for everyone but followers,
  // so it stacks under the roles instead, like on a phone.
  // A hiring record exists when the box database has one
  // (`exhaust.integrity`, what `hiring.trackRecord` reads first) or the index
  // aggregates do. Without either, the section would only say it isn't
  // tracked, so it is left out, like any other band with no data.
  const hasHiringRecord = !!data.exhaust?.integrity || data.hasTrackRecord;
  const railBeside =
    cadenceStripHasContent(data.exhaust?.cadence) || verdictBandHasContent(data.exhaust?.health, data.nowMs);
  // "9 of the 68 roles tracked here may no longer be live" — see
  // company-page-copy.ts for why the count is derivable from
  // `data.ghostFlaggedPct`.
  const staleShare = staleShareText(data);

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
          description: "SEC filings, funding rounds, federal contracts, WARN layoffs and H-1B approvals.",
          count: `${filingsCount} record${filingsCount === 1 ? "" : "s"}`,
        }
      : null,
  ].filter((t): t is ExhaustGateTeaser => t !== null);


  return (
    <CompanyFollowChannelProvider domain={data.domain}>
      <div data-testid="company-page" className="shell-row py-8 pb-12 sm:pb-16">
        {/* Identity header: name, the "is X hiring?" answer folded straight
            into the subtitle line, and Follow as the page's one primary
            action (`variant="primary"`). Blue is for interactive accents,
            never the primary CTA. */}
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-5">
            <CompanyLogo domain={data.domain} name={data.name} size="lg" />
            <div className="min-w-0 flex-1">
              <PageTitle>{data.name}</PageTitle>
              {data.oneLiner && (
                <p className="mt-1.5 text-sm sm:text-base leading-snug text-muted-foreground">
                  {data.oneLiner}
                </p>
              )}
              <p className="mt-3 flex items-center gap-2 text-base leading-snug text-foreground">
                {hiring.hasOpenRoles && (
                  <span className="h-2 w-2 shrink-0 rounded-pill bg-live" aria-hidden />
                )}
                <span data-testid="company-hiring-headline">
                  {humanizeProjectorHeadline(hiring.headline)}
                  {hiring.liveCheck && (
                    <span className="text-muted-foreground">{` · ${hiring.liveCheck}`}</span>
                  )}
                </span>
              </p>
              {/* Facts row — domain (a real link), HQ, hiring geos, remote
                  count, stage, plus the profile's size, founding year and
                  type — plain " · "-joined text, no icons (rulebook). These
                  are the one place the page states those profile facts. */}
              <div className="mt-3 text-sm text-muted-foreground">
                <DotSeparated
                  items={[
                    <a
                      key="domain"
                      href={`https://${facts.domain}`}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-brand hover:underline"
                    >
                      {facts.domain}
                    </a>,
                    // HQ renders at the precision the box actually stored —
                    // country only, never an invented city (contract rule).
                    profile?.hqCountry,
                    facts.hiringGeos,
                    facts.remoteShare && facts.remoteJobsUrl ? (
                      <Link key="remote" href={facts.remoteJobsUrl} data-testid="company-remote-share" className="text-brand hover:underline">
                        {facts.remoteShare}
                      </Link>
                    ) : (
                      facts.remoteShare
                    ),
                    data.stage,
                    ...headerChips,
                  ]}
                />
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

        {/* Two columns under the header: the stat row and the roles first in
            the main column, the posting rhythm and the hiring record in a
            320px rail — one stacked column under `lg`, or when the rail has
            nothing public (`railBeside`). */}
        <div className={cn("grid gap-10", railBeside && "lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start")}>
          <div className="min-w-0">
            {/* Open roles are the reason a job seeker landed here, so the
                roles list is the first thing under the header. */}
            <CompanyRoleSearch
              jobs={data.jobs}
              companyDomain={data.domain}
              companySlug={data.slug}
              companyName={data.name}
              openCountLabel={openCountText(data)}
              searchesPartialWindow={!ghostPctIsCompanyWide}
              jobsSearchUrl={jobsSearchUrl}
              now={now}
              stats={roleStats}
            />

            {/* Quiet secondary content — hiring changes, tech stack, and
                news — never ahead of the roles a visitor came here for. */}
            <div data-testid="company-secondary" className="mt-10 space-y-8">
              {/* The latest change-event line is the public teaser: shown
                  while the list is locked, gone once a follower sees the
                  list it would only repeat. */}
              <CompanyIntelGate
                domain={data.domain}
                slug={data.slug}
                displayName={data.name}
                fallback={mainIntelGateFallback}
                lockedPreview={<CompanyChangeEventTeaser event={data.changeEvents[0] ?? null} />}
              >
                <CompanyChangeEvents events={changeEvents} companyName={data.name} />
                <CompanyIntelligenceGrid intelligence={data.intelligence} companyName={data.name} />
              </CompanyIntelGate>
            </div>
          </div>

          {/* Rail: public evidence first (posting rhythm, the latest hiring
              review), then the follower-only hiring record and list health.
              The rail's gate passes a null fallback: a locked visitor already
              sees the page's one card (see `mainIntelGateFallback`). */}
          <aside data-testid="company-rail" className="space-y-8 empty:hidden">
            {data.exhaust && <CompanyCadenceStrip cadence={data.exhaust.cadence} />}
            {data.exhaust && <CompanyVerdictBand health={data.exhaust.health} nowMs={data.nowMs} />}
            {(hasHiringRecord || !!staleShare) && (
              <CompanyIntelGate
                domain={data.domain}
                slug={data.slug}
                displayName={data.name}
                testId="company-intel-gate-record"
                fallback={null}
              >
                <div className="space-y-8">
                  {/* Plain-language hiring record, read from the box database
                      first (`hiring.trackRecord`), with the provenance note
                      that describes it. The 30-day share (`hiring.freshness`)
                      is not repeated here: the stat row states it publicly
                      under the same census gate. */}
                  {hasHiringRecord && (
                    <section data-testid="company-hiring-activity" className="border-t border-border pt-6">
                      <h2 className="text-base font-semibold leading-snug text-foreground">
                        Hiring record
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-foreground">{hiring.trackRecord}</p>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Counted from job postings Velai observed, not fundraising data, employee reviews,
                        or third-party valuations.
                      </p>
                    </section>
                  )}

                  {/* List health — the ghost-flagged share restated as a count
                      instead of a bare, jargon-labelled percentage tile. */}
                  {staleShare && (
                    <section className="border-t border-border pt-6">
                      <h2 className="text-base font-semibold leading-snug text-foreground">
                        List health
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{staleShare}</p>
                    </section>
                  )}
                </div>
              </CompanyIntelGate>
            )}
          </aside>
        </div>

        {/* Band 5 — "On the record": enrichment facts, public per D1. */}
        {data.exhaust && (
          <div className="mt-10">
            <CompanyFactRow exhaust={data.exhaust} />
          </div>
        )}

        {/* Bands 6/8/9 — listing integrity, hiring infrastructure, filings.
            Change history is not here: one CompanyChangeEvents lives in
            CompanyIntelGate above. Signed-in only; signed-out visitors see
            real-count teasers in the site's one sign-up card. */}
        {data.exhaust && exhaustGateTeasers.length > 0 && (
          <div className="mt-10">
            <CompanyExhaustGate slug={data.slug} displayName={data.name} teasers={exhaustGateTeasers} signedIn={signedIn}>
              <div className="space-y-8">
                <CompanyIntegrityBand integrity={data.exhaust.integrity} nowMs={data.nowMs} />
                <CompanyTechStackBand techStack={data.exhaust.techStack} />
                <CompanyFilingsBand exhaust={data.exhaust} />
              </div>
            </CompanyExhaustGate>
          </div>
        )}
      </div>
    </CompanyFollowChannelProvider>
  );
}

import type { Metadata } from "next";
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
import { DotSeparated } from "@/components/ui/dot-separated";
import { getServerUser } from "@/lib/auth/server-user";
import type { CompanyChangeEvent } from "@/lib/companies/types";
import { humanizeProjectorHeadline } from "@/lib/companies/events";
import { getCompanyPageData } from "@/lib/companies/get-company";
import { companyUnlockStep } from "@/lib/company/unlock-step";
import {
  buildCompanyFacts,
  buildCompanyHiringAnswer,
  buildCompanyJobsUrl,
  buildCompanyPageMetadata,
  openCountText,
  sampleCoversAllRoles,
} from "@/lib/companies/presentation";
import { buildCompanyFaqItems, buildCompanyOrganizationJsonLd, buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { PageTitle } from "@/components/ui/heading";

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
  // Same `getServerUser()` `CompanyExhaustGate` uses for its own sign-in
  // check, read once here to decide whether the main column's
  // `CompanyIntelGate` may show its own "Follow" card. An anonymous visitor
  // already gets a single combined ask from `CompanyExhaustGate`'s sign-in
  // card below (full record + hiring history); this gate's own card would
  // stack a second, near-duplicate one, so it renders nothing instead.
  // `following` is never known here — that's client-only state
  // (Firestore/localStorage) — so this only ever answers "if not yet
  // following, what's the next step?"; `CompanyIntelGate`'s own
  // client-computed `unlocked` flag independently suppresses its card
  // regardless of this once the visitor really is following.
  const signedIn = !!(await getServerUser());
  const mainIntelGateFallback =
    companyUnlockStep({ signedIn, following: false }) === "sign-in" ? null : undefined;
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
      <div className="border-b border-border">
        <nav className="shell-row flex h-10 items-center text-sm text-muted-foreground">
          <Link href="/jobs" className="text-brand hover:underline">
            Find jobs
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          {data.name}
        </nav>
      </div>

      <CompanyFollowChannelProvider domain={data.domain}>
      <div data-testid="company-page" className="shell-row py-8 pb-12 sm:pb-16">
        {/* Identity header: name, the "is X hiring?" answer folded straight
            into the subtitle line (no separate boxed KPI card), and Follow
            as the page's one primary action — inverted-ink treatment via
            `variant="primary"` (maps to Button's `default` variant). Blue
            (`variant="brand"`, used below for the roles list's "View all"
            button) is for interactive accents, never the primary CTA. */}
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
                  share, plus any header chips (stage, employer size, founding
                  year, org type) — all plain " · "-joined text, no icons and
                  no separate pill row (rulebook: facts row has no icons,
                  tags/pills are excluded). Absence is still silence: a fact
                  with nothing behind it (`buildCompanyFacts`) just doesn't
                  contribute a segment. */}
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

        {/* Bands 2-3 — the Hiring Record's public, full-width bands: the
            health-review verdict and the posting-cadence strip (the page's
            signature band, public per design call DC1). Both drop cleanly
            when the exhaust module has nothing for this domain. */}
        {data.exhaust && (
          <div className="mb-8 space-y-4">
            <CompanyVerdictBand health={data.exhaust.health} nowMs={data.nowMs} />
            <CompanyCadenceStrip cadence={data.exhaust.cadence} />
          </div>
        )}

        {/* Two-column body below the header: roles + gated change/public
            content in the main column, the hiring record and list health in
            a narrower rail — collapses to one stacked column under `lg`. */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
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
            <div data-testid="company-secondary" className="mt-10 space-y-8">
              <CompanyChangeEventTeaser event={data.changeEvents[0] ?? null} />

              <CompanyIntelGate
                domain={data.domain}
                slug={data.slug}
                displayName={data.name}
                fallback={mainIntelGateFallback}
              >
                <CompanyChangeEvents events={changeEvents} companyName={data.name} />
                <CompanyIntelligenceGrid intelligence={data.intelligence} companyName={data.name} />
              </CompanyIntelGate>
            </div>
          </div>

          {/* Rail: the hiring record and list health — same follower-only
              boundary as the main column's intel gate, but a locked visitor
              would already see the page's one card (this gate's own, or
              CompanyExhaustGate's sign-in card below — see
              `mainIntelGateFallback`), so this instance's fallback prop is
              set to null unconditionally and it renders nothing rather than
              a second, near-duplicate card. Unlocked, its content renders
              normally. */}
          <aside className="space-y-4">
            <CompanyIntelGate
              domain={data.domain}
              slug={data.slug}
              displayName={data.name}
              testId="company-intel-gate-record"
              fallback={null}
            >
              <div className="space-y-4">
                {/* Plain-language hiring record — same figures the old
                    "Hiring activity" section drew from, now its own named
                    rail box instead of a shared block with the intel grid. */}
                <section data-testid="company-hiring-activity" className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    Hiring record
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-foreground">{hiring.trackRecord}</p>
                  {hiring.freshness && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hiring.freshness}</p>
                  )}
                  {/* The provenance note describes this track record, so it
                      renders only when there is one: the box database's
                      record (`exhaust.integrity`, what `hiring.trackRecord`
                      reads first) or the index aggregates. Without either it
                      would assert an observation that was never made. */}
                  {(data.exhaust?.integrity || data.hasTrackRecord) && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Counted from job postings Velai observed, not fundraising data, employee reviews,
                      or third-party valuations.
                    </p>
                  )}
                </section>

                {/* List health — the ghost-flagged share restated as a count
                    instead of a bare, jargon-labelled percentage tile. */}
                {staleShare && (
                  <section className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-6">
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
          <div className="mt-8">
            <CompanyFactRow exhaust={data.exhaust} />
          </div>
        )}

        {/* Bands 6/8/9 — listing integrity, hiring infrastructure, filings.
            Change history is not here: one CompanyChangeEvents lives in
            CompanyIntelGate above. Signed-in only; signed-out visitors see
            real-count teasers, never blurred content. */}
        {data.exhaust && exhaustGateTeasers.length > 0 && (
          <div className="mt-8">
            <CompanyExhaustGate slug={data.slug} displayName={data.name} teasers={exhaustGateTeasers}>
              <div className="space-y-4">
                <CompanyIntegrityBand integrity={data.exhaust.integrity} nowMs={data.nowMs} />
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

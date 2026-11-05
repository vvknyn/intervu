import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { CompanyFollowChannelProvider } from "@/components/companies/CompanyFollowChannelProvider";
import { CompanyChangeEventTeaser } from "@/components/company/CompanyChangeEventTeaser";
import { CompanyChangeEvents } from "@/components/company/CompanyChangeEvents";
import { CompanyExhaustGate, type ExhaustGateTeaser } from "@/components/company/CompanyExhaustGate";
import { HiringDot } from "@/components/company/HiringDot";
import { CompanyFactRow } from "@/components/company/CompanyFactRow";
import { CompanyFilingsBand } from "@/components/company/CompanyFilingsBand";
import { CompanyIntegrityBand } from "@/components/company/CompanyIntegrityBand";
import { CompanyIntelGate } from "@/components/company/CompanyIntelGate";
import { staleShareText } from "@/components/company/company-page-copy";
import { CompanyIntelligenceGrid } from "@/components/company/CompanyIntelligenceGrid";
import { CompanySections } from "@/components/company/CompanySections";
import type { RelatedCompanies } from "@/lib/companies/related-companies";
import { buildCompanyFaq } from "@/lib/companies/company-faq";
import { companySections } from "@/lib/companies/company-sections";
import { CompanyRoleSearch } from "@/components/company/CompanyRoleSearch";
import { CompanyTechStackBand } from "@/components/company/CompanyTechStackBand";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { PageTitle } from "@/components/ui/heading";
import { humanizeProjectorHeadline } from "@/lib/companies/events";
import type { CompanyChangeEvent, CompanyPageData } from "@/lib/companies/types";
import { companyUnlockStep } from "@/lib/company/unlock-step";
import { formatCount } from "@/lib/format";
import {
  buildCompanyHiringAnswer,
  buildCompanyJobsUrl,
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
  related,
}: {
  data: CompanyPageData;
  /** From `getServerUser()` in the route; decides which gate card shows. */
  signedIn: boolean;
  /** The route's one clock read (see page.tsx). */
  now: number;
  /** Same-skill or same-country companies from the sitemap set; empty omits the section. */
  related: RelatedCompanies | null;
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
  const staleShare = staleShareText(data);
  const faq = buildCompanyFaq(data.facts, data.nowMs);
  const roles = (
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
  );
  const sectionIds = companySections(data.facts, { roleCount: data.jobs.length, relatedCount: related?.companies.length ?? 0, faqCount: faq.length });
  const sectionCtx = { facts: data.facts, exhaust: data.exhaust, nowMs: data.nowMs, roles, related, faq, staleShare };

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
          count: `${formatCount(integrityCount)} closings on record`,
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
          count: `${formatCount(filingsCount)} record${filingsCount === 1 ? "" : "s"}`,
        }
      : null,
  ].filter((t): t is ExhaustGateTeaser => t !== null);


  return (
    <CompanyFollowChannelProvider domain={data.domain}>
      <div data-testid="company-page" className="shell-row page-top pb-12 sm:pb-16">
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
                <HiringDot dot={hiring.dot} />
                <span data-testid="company-hiring-headline">
                  {humanizeProjectorHeadline(hiring.headline)}
                  {hiring.liveCheck && (
                    <span className="text-muted-foreground">{` · ${hiring.liveCheck}`}</span>
                  )}
                </span>
              </p>
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

        {/* One column of public sections, in `companySections` order; the roles
            list is one of them. Gated actions stay in the secondary block. */}
        <div className="grid gap-10">
          <div className="min-w-0 space-y-8">
            <CompanySections ids={sectionIds} ctx={sectionCtx} />
            <div data-testid="company-secondary" className="space-y-8">
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
                <CompanyIntegrityBand integrity={data.exhaust.integrity} />
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

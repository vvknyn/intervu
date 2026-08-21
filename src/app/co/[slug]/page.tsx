import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { CompanyChangeEvents } from "@/components/company/CompanyChangeEvents";
import { staleShareText } from "@/components/company/company-page-copy";
import { CompanyIntelligenceGrid } from "@/components/company/CompanyIntelligenceGrid";
import { CompanyRoleSearch } from "@/components/company/CompanyRoleSearch";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { getCompanyPageData } from "@/lib/companies/get-company";
import {
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
  // "9 of the 68 shown may no longer be live" — see company-page-copy.ts for
  // why the count is always derivable from `ghostFlaggedPct` and doesn't
  // need the company-wide/sample split above.
  const staleShare = staleShareText(data);
  const faqJsonLd = buildFaqPageJsonLd(
    buildCompanyFaqItems({
      companyName: data.name,
      // The same sentence the body renders below — see `CompanyFaqInput`.
      hiringAnswer: hiring.headline,
      // The FAQ answer states this share as a fact about "this company's
      // tracked postings". Where the percentage only covers the fetched
      // window, that question is dropped rather than answered with a sample
      // dressed as a census — the same reason `buildCompanyFaqItems` already
      // skips it on `null` instead of fabricating 0%.
      ghostFlaggedPct: ghostPctIsCompanyWide ? data.ghostFlaggedPct : null,
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

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(companyJsonLd) }}
      />
      <div className="border-b border-border bg-card px-4 py-3 sm:px-8 xl:px-10">
        <nav className="mx-auto max-w-6xl xl:max-w-7xl text-xs text-muted-foreground">
          <Link href="/jobs" className="text-brand hover:underline">
            Find jobs
          </Link>
          {" / "}
          {data.name}
        </nav>
      </div>

      <main data-testid="company-page" className="mx-auto max-w-6xl xl:max-w-7xl px-4 py-8 pb-12 sm:px-8 sm:pb-16 xl:px-10">
        {/* Identity header: name, the "is X hiring?" answer folded straight
            into the subtitle line (no separate boxed KPI card), and Follow
            as the page's one primary action — same inverted-ink treatment
            as the house system's other primary CTAs (`variant="brand"`,
            already used below for the roles list's own "View all" button). */}
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-5">
            <CompanyLogo domain={data.domain} name={data.name} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[32px] sm:text-[36px] font-semibold tracking-tight">{data.name}</h1>
              {data.oneLiner && (
                <p className="mt-1.5 text-[15px] sm:text-[16px] leading-snug text-muted-foreground">
                  {data.oneLiner}
                </p>
              )}
              <p className="mt-3 flex items-center gap-2 text-[16px] sm:text-[17px] font-medium leading-snug text-foreground">
                {hiring.hasOpenRoles && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
                )}
                {hiring.headline}
              </p>
              {data.stage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded border border-border bg-chip px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {data.stage}
                  </span>
                </div>
              )}
            </div>
          </div>
          <CompanyFollowControl
            key={data.domain}
            domain={data.domain}
            slug={data.slug}
            displayName={data.name}
            variant="brand"
            className="shrink-0 sm:self-start"
          />
        </header>

        {/* The page's body — open roles are the reason a job seeker landed
            here, so the roles list is the first thing under the header, not
            four KPI tiles and an intelligence suite. */}
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

        {/* Everything past this point is quiet secondary content — hiring
            activity, honest data-quality context, tech stack, and news —
            never ahead of the roles a visitor came here for. */}
        <div data-testid="company-secondary" className="mt-10 space-y-8">
          <CompanyChangeEvents events={data.changeEvents} companyName={data.name} />

          {/* Plain-language hiring record + the ghost-flagged share restated
              as a count (`staleShare`) instead of a bare, jargon-labelled
              percentage tile. */}
          <section data-testid="company-hiring-activity" className="rounded-2xl bg-chip px-5 py-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hiring activity
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground">{hiring.trackRecord}</p>
            {hiring.freshness && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{hiring.freshness}</p>
            )}
            {staleShare && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{staleShare}</p>
            )}
          </section>

          <CompanyIntelligenceGrid intelligence={data.intelligence} companyName={data.name} />

          {/* The 90-day provenance note describes the opened/closed track
              record specifically, and that is the one thing this page cannot
              show today (`hasTrackRecord` is false for every employer until
              the `company_*` aggregate sync lands). Printed under an assumed
              90-day window it asserts an observation that was never made — so
              it renders only when there is a track record for it to
              describe. */}
          {data.hasTrackRecord && (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Metrics derived from observed job postings over 90 days — not fundraising data, employee
              reviews, or third-party valuations.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

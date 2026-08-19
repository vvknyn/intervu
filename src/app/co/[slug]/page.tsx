import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { CompanyChangeEvents } from "@/components/company/CompanyChangeEvents";
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

function formatKpi(value: number | null): string {
  return value == null ? "—" : String(value);
}

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
  const isElite = data.boards.includes("elite");
  const ghostPctIsCompanyWide = sampleCoversAllRoles(data);
  const hiring = buildCompanyHiringAnswer(data, data.nowMs);
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
        <header className="mb-8 flex gap-5 items-start">
          <CompanyLogo domain={data.domain} name={data.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] sm:text-[36px] font-semibold tracking-tight">{data.name}</h1>
            {data.oneLiner && (
              <p className="mt-1.5 text-[15px] sm:text-[16px] leading-snug text-muted-foreground">
                {data.oneLiner}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {isElite && (
                <span className="rounded border border-brand/20 bg-brand/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-brand">
                  Elite
                </span>
              )}
              {data.stage && (
                <span className="rounded border border-border bg-chip px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {data.stage}
                </span>
              )}
            </div>
          </div>
          <CompanyFollowControl
            key={data.domain}
            domain={data.domain}
            slug={data.slug}
            displayName={data.name}
            className="shrink-0 self-start"
          />
        </header>

        {/* The page's title asks "Is X hiring?" — this answers it in the body,
            in the same words the FAQPage structured data gives a crawler.
            `trackRecord` is what keeps the block honest while the 90-day
            aggregates are null: it names the gap the two em-dashes below
            represent, and turns into the real record with no code change once
            the `company_*` sync lands. */}
        <section
          data-testid="company-hiring-answer"
          className="mb-6 rounded-2xl border border-border bg-card px-6 py-5 shadow-xs"
        >
          <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Is {data.name} hiring?
          </h2>
          <p className="mt-2 flex items-center gap-2 font-display text-[20px] sm:text-[22px] font-semibold leading-snug">
            {hiring.hasOpenRoles && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
            )}
            {hiring.headline}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            {hiring.trackRecord}
          </p>
          {hiring.freshness && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {hiring.freshness}
            </p>
          )}
        </section>

        <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <Kpi value={openCountText(data)} label="Open roles" />
          <Kpi value={formatKpi(data.opened90d)} label="Opened 90d" />
          <Kpi value={formatKpi(data.closed90d)} label="Closed 90d" />
          <Kpi
            value={data.ghostFlaggedPct == null ? "—" : `${data.ghostFlaggedPct}%`}
            // Names the base the share was actually computed over whenever
            // that base is smaller than the count beside it, so the tile
            // stops reading as a company-wide audit it never was.
            label={
              ghostPctIsCompanyWide
                ? "Possibly stale"
                : `Possibly stale of ${data.jobs.length} shown`
            }
          />
        </div>

        <CompanyChangeEvents events={data.changeEvents} companyName={data.name} />

        <CompanyIntelligenceGrid intelligence={data.intelligence} companyName={data.name} />

        <CompanyRoleSearch
          jobs={data.jobs}
          companyDomain={data.domain}
          companyName={data.name}
          openCountLabel={openCountText(data)}
          searchesPartialWindow={!sampleCoversAllRoles(data)}
          jobsSearchUrl={jobsSearchUrl}
          now={now}
        />

        {/* The 90-day provenance note describes the opened/closed track
            record specifically, and that is the one thing this page cannot
            show today (`hasTrackRecord` is false for every employer until the
            `company_*` aggregate sync lands). Printed under three em-dashes
            it asserts a 90-day observation window behind numbers that were
            never observed — so it renders only when there is a track record
            for it to describe. */}
        {data.hasTrackRecord && (
          <p className="mt-6 rounded-2xl bg-chip px-4 py-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Metrics derived from observed job postings over 90 days — not fundraising data, employee
            reviews, or third-party valuations.
          </p>
        )}
      </main>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center shadow-xs">
      <span className="inline-block border-b-[3px] border-brand pb-1 text-[26px] font-medium tracking-tight">
        {value}
      </span>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

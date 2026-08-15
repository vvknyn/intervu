import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/companies/FollowButton";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { Button } from "@/components/ui/button";
import { getCompanyPageData } from "@/lib/companies/get-company";
import {
  buildCompanyHiringAnswer,
  buildCompanyPageMetadata,
  ghostPctCoversAllRoles,
  openCountText,
} from "@/lib/companies/presentation";
import {
  decodeText,
  ghostMetaFor,
  locationText,
  prettyEnum,
  salaryText,
} from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { buildCompanyFaqItems, buildCompanyOrganizationJsonLd, buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { cn } from "@/lib/utils";

const ROLES_PREVIEW = 10;

function formatKpi(value: number | null): string {
  return value == null ? "—" : String(value);
}

function roleMeta(job: PublicJob): string {
  const parts = [locationText(job), salaryText(job), prettyEnum(job.experience_level)].filter(Boolean);
  return parts.join(" · ");
}

function roleGhostLine(job: PublicJob): { text: string; live: boolean } | null {
  if (job.ghost_badge === "likely_ghost") {
    const meta = ghostMetaFor(job.ghost_badge, false);
    return meta ? { text: `● ${meta.label}`, live: false } : null;
  }
  if (job.ghost_badge === "clear" || !job.ghost_badge) {
    return { text: "Live · no ghost signals", live: true };
  }
  return null;
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

  const preview = data.jobs.slice(0, ROLES_PREVIEW);
  // /jobs is the only route that consumes `q` (src/lib/jobs/url-state.ts) —
  // `/` is the marketing hero page and silently drops the param.
  const jobsSearchUrl = `/jobs?q=${encodeURIComponent(data.name)}`;
  const isElite = data.boards.includes("elite");
  const ghostPctIsCompanyWide = ghostPctCoversAllRoles(data);
  const hiring = buildCompanyHiringAnswer(data);
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
    buildCompanyOrganizationJsonLd({ name: data.name, domain: data.domain }),
    ...(faqJsonLd ? [faqJsonLd] : []),
  ];

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(companyJsonLd) }}
      />
      <div className="border-b border-border bg-card px-4 py-3 sm:px-6">
        <nav className="mx-auto max-w-[900px] font-mono text-xs text-muted-foreground">
          <Link href="/jobs" className="text-brand hover:underline">
            Find jobs
          </Link>
          {" / "}
          {data.name}
        </nav>
      </div>

      <main data-testid="company-page" className="mx-auto max-w-[900px] px-4 py-8 pb-28 sm:px-6">
        <header className="mb-7 flex gap-4">
          <CompanyLogo domain={data.domain} name={data.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] font-semibold tracking-tight">{data.name}</h1>
            {data.oneLiner && (
              <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground">
                {data.oneLiner}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {isElite && (
                <span className="rounded border border-brand/20 bg-brand/10 px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-brand">
                  Elite
                </span>
              )}
              {data.stage && (
                <span className="rounded border border-border bg-chip px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {data.stage}
                </span>
              )}
            </div>
          </div>
          <FollowButton
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
          className="mb-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs"
        >
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Is {data.name} hiring?
          </h2>
          <p className="mt-2 flex items-center gap-2 font-display text-[19px] font-semibold leading-snug">
            {hiring.hasOpenRoles && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
            )}
            {hiring.headline}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
            {hiring.trackRecord}
          </p>
        </section>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                ? "Ghost-flagged"
                : `Ghost-flagged of ${data.jobs.length} shown`
            }
          />
        </div>

        <section>
          <h2 className="mb-3.5 flex items-baseline justify-between font-display text-[19px] font-semibold">
            Open roles
            {data.jobs.length > 0 && (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {preview.length} of {openCountText(data)} shown
              </span>
            )}
          </h2>

          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open roles indexed right now.</p>
          ) : (
            <ul className="space-y-2">
              {preview.map((job) => {
                const ghost = roleGhostLine(job);
                return (
                  <li key={job.id}>
                    <Link
                      href={`/jobs?job=${encodeURIComponent(job.id)}`}
                      className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs transition-colors hover:border-border-strong"
                    >
                      <CompanyLogo domain={data.domain} name={data.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold">{decodeText(job.title)}</div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {roleMeta(job)}
                        </div>
                        {ghost && (
                          <div
                            className={cn(
                              "mt-1.5 flex items-center gap-1.5 font-mono text-[11px]",
                              ghost.live ? "text-brand" : "text-muted-foreground",
                            )}
                          >
                            {ghost.live && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
                            )}
                            {ghost.text}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* The 90-day provenance note describes the opened/closed track
            record specifically, and that is the one thing this page cannot
            show today (`hasTrackRecord` is false for every employer until the
            `company_*` aggregate sync lands). Printed under three em-dashes
            it asserts a 90-day observation window behind numbers that were
            never observed — so it renders only when there is a track record
            for it to describe. */}
        {data.hasTrackRecord && (
          <p className="mt-6 rounded-2xl bg-chip px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
            Metrics derived from observed job postings over 90 days — not fundraising data, employee
            reviews, or third-party valuations.
          </p>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-[900px] flex-wrap justify-center gap-3">
          <Button asChild variant="brand">
            <Link href={jobsSearchUrl}>View all {openCountText(data)} jobs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center shadow-xs">
      <span className="inline-block border-b-[3px] border-brand pb-1 font-mono text-[26px] font-medium tracking-tight">
        {value}
      </span>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

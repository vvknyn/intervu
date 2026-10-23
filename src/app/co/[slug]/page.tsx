import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyPageBody } from "@/components/company/CompanyPageBody";
import { CompanyPageSkeleton } from "@/components/company/CompanyPageSkeleton";
import { getServerUser } from "@/lib/auth/server-user";
import { humanizeProjectorHeadline } from "@/lib/companies/events";
import { companyExists, getCompanyPageData } from "@/lib/companies/get-company";
import { reportShownJobs } from "@/lib/jobs/liveness-demand";
import { buildCompanyHiringAnswer, buildCompanyPageMetadata } from "@/lib/companies/presentation";
import { buildCompanyFaqItems, buildCompanyOrganizationJsonLd, buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { robotsMetadataFor } from "@/lib/seo/indexability";

// `cache()` so generateMetadata and the page body share ONE load per request
// (same pattern as jobs/[slug]/page.tsx): each load is a 200-role search plus
// the news, events and hiring-record reads, and it used to run twice.
const loadCompany = cache((slug: string) => getCompanyPageData(slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadCompany(slug);
  if (!data) return { title: "Company not found", ...robotsMetadataFor(`/co/${slug}`, undefined, { pageIndexable: false, inSitemap: false }) };
  return buildCompanyPageMetadata(data);
}

// The page awaits ONLY the existence check before its first byte, so an
// unknown or malformed slug is a real 404; the slow load streams behind the
// skeleton. (A route-level loading.tsx would commit 200 before notFound().)
export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await companyExists(slug))) notFound();
  return (
    <Suspense fallback={<CompanyPageSkeleton />}>
      <CompanyPageContent slug={slug} />
    </Suspense>
  );
}

async function CompanyPageContent({ slug }: { slug: string }) {
  const data = await loadCompany(slug);
  if (!data) notFound();
  // Buffer-only: the roles this visitor is about to see get their links
  // checked first (liveness-demand.ts).
  reportShownJobs(data.jobs);
  // The page's one sign-in read: it picks which gate card shows and opens
  // `CompanyExhaustGate`'s signed-in bands.
  const signedIn = !!(await getServerUser());
  // One clock read for the whole page, taken here rather than inside JSX so
  // every staleness decision below is measured against a single instant.
  // The purity rule fires on any Date.now() in a component body and can't
  // see that this is an async Server Component — rendered once, per request,
  // on the server, where a clock read is neither unstable nor re-entrant.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const hiring = buildCompanyHiringAnswer(data, data.nowMs);
  const faqJsonLd = buildFaqPageJsonLd(
    buildCompanyFaqItems({
      companyName: data.name,
      // The same sentence the body renders — see `CompanyFaqInput`.
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

      <CompanyPageBody data={data} signedIn={signedIn} now={now} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { topHubCompanies, type DirectoryEntry } from "@/lib/companies/directory-index";
import { companyBoardPath } from "@/lib/companies/paths";
import { searchJobs } from "@/lib/jobs/search";
import { careerHubJobsHref, careerHubSearchParams, getAllCareerHubSlugs, getCareerHub, otherCareerHubs, type CareerHub } from "@/lib/seo/career-hubs";
import { SITE_NAME } from "@/lib/seo/constants";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

// Each hub lists live companies, so it is rendered per request, not baked at build time.
export const dynamic = "force-dynamic";

/** Roles per hub search the company list is read from (the search has no company facet, so
 *  companies are grouped from this page of hits). */
const HUB_COMPANY_SAMPLE = 200;

/** Indexable companies with the most roles matching the hub's search; none when either read fails. */
async function hubCompanies(hub: CareerHub): Promise<DirectoryEntry[]> {
  try {
    const [{ hits, unavailable }, indexable] = await Promise.all([
      searchJobs({ ...careerHubSearchParams(hub), limit: HUB_COMPANY_SAMPLE }),
      resolveIndexableCompanies(),
    ]);
    if (unavailable) {
      console.error(`career hub ${hub.slug}: job search unavailable, company list omitted`);
      return [];
    }
    return topHubCompanies(hits, indexable);
  } catch (error) {
    console.error(`career hub ${hub.slug}: company list omitted: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function generateStaticParams() {
  return getAllCareerHubSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hub = getCareerHub(slug);
  if (!hub) return {};
  return {
    description: hub.description,
    ...robotsMetadataFor(hub.path),
    ...canonicalMetadata(hub.path, hub.title, hub.description),
  };
}

export default async function CareerHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hub = getCareerHub(slug);
  if (!hub) notFound();

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: SITE_NAME, path: "/" },
    { name: hub.label, path: hub.path },
  ]);
  const jobsHref = careerHubJobsHref(hub);
  const companies = await hubCompanies(hub);

  return (
    <PageContainer measure="reading" data-testid={`career-hub-${hub.slug}`} className="py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <p className="text-xs font-semibold text-muted-foreground">Career hub</p>
      <PageTitle className="mt-3">{hub.h1}</PageTitle>

      <Prose className="mt-6">
        {hub.intro.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </Prose>

      <nav aria-label="Related career topics" className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href={jobsHref} rel="nofollow" data-testid="career-hub-search" className="font-semibold text-brand hover:underline">
          {hub.searchLabel}
        </Link>
        {otherCareerHubs(hub.slug).map((other) => (
          <Link key={other.slug} href={other.path} className="text-muted-foreground hover:text-foreground">
            {other.label}
          </Link>
        ))}
        {hub.alternativePath && (
          <Link href={hub.alternativePath} className="text-muted-foreground hover:text-foreground">
            Why velai instead of a big board
          </Link>
        )}
      </nav>

      {companies.length > 0 && (
        <section aria-labelledby="hub-companies" className="mt-8" data-testid="career-hub-companies">
          <SectionTitle id="hub-companies">Companies hiring for {hub.label.toLowerCase()}</SectionTitle>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {companies.map(({ domain, name }) => (
              <li key={domain}>
                <Link href={companyBoardPath(domain)} className="hover:underline">
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}

import Link from "next/link";
import { careerHubJobsHref, otherCareerHubs, type CareerHub } from "@/lib/seo/career-hubs";
import { SITE_NAME } from "@/lib/seo/constants";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import type { HubFacts } from "@/lib/seo/hub-facts";
import { Prose } from "@/components/ui/prose";
import { PageEyebrow, PageTitle } from "@/components/ui/heading";
import { HubSections } from "@/components/seo/HubSections";
import { PageContainer } from "@/components/layout/PageContainer";

/**
 * A career hub page once its live facts are in hand. The page reads them from the search index and the box database
 * (a failed read omits a section, never the page); /mock/career-hub renders this same body over made-up facts, so a
 * cloud session that reaches neither still measures the sections the hub draws only when they have data (J-MOB-33).
 */
export function CareerHubBody({ hub, facts, now }: { hub: CareerHub; facts: HubFacts; now: number }) {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: SITE_NAME, path: "/" },
    { name: hub.label, path: hub.path },
  ]);
  const jobsHref = careerHubJobsHref(hub);

  return (
    <PageContainer measure="reading" data-testid={`career-hub-${hub.slug}`} className="page-top pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <PageEyebrow>Career hub</PageEyebrow>
      <PageTitle>{hub.h1}</PageTitle>

      <Prose className="mt-6">
        {hub.intro.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </Prose>

      <nav aria-label="Related career topics" className="link-cloud mt-8 text-sm">
        <Link href={jobsHref} rel="nofollow" data-testid="career-hub-search" className="text-action">
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

      <HubSections facts={facts} label={hub.label} now={now} />
    </PageContainer>
  );
}

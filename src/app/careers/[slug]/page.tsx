import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { careerHubJobsHref, getAllCareerHubSlugs, getCareerHub, otherCareerHubs } from "@/lib/seo/career-hubs";
import { SITE_NAME } from "@/lib/seo/constants";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { Prose } from "@/components/ui/prose";
import { PageTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

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
    </PageContainer>
  );
}

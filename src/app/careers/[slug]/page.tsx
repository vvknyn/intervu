import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { careerHubJobsHref, getAllCareerHubSlugs, getCareerHub } from "@/lib/seo/career-hubs";
import { robotsMetadataFor } from "@/lib/seo/indexability";
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
    title: { absolute: hub.title },
    description: hub.description,
    ...robotsMetadataFor(hub.path),
    ...canonicalMetadata(hub.path, hub.title, hub.description),
  };
}

export default async function CareerHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hub = getCareerHub(slug);
  if (!hub) notFound();

  const related = hub.relatedSlugs
    .map((relatedSlug) => getCareerHub(relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  const jobsHref = careerHubJobsHref(hub);

  return (
    <PageContainer measure="reading" data-testid={`career-hub-${hub.slug}`} className="py-10">
      <p className="text-xs font-semibold text-muted-foreground">Career hub</p>
      <PageTitle className="mt-3">{hub.h1}</PageTitle>

      <Prose className="mt-6">
        {hub.intro.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </Prose>

      <nav aria-label="Related career topics" className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href={jobsHref} data-testid="career-hub-search" className="font-semibold text-brand hover:underline">
          {hub.searchLabel}
        </Link>
        {related.map((relatedHub) => (
          <Link key={relatedHub.slug} href={relatedHub.path} className="text-muted-foreground hover:text-foreground">
            {relatedHub.h1}
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

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { careerHubJobsHref, getAllCareerHubSlugs, getCareerHub } from "@/lib/seo/career-hubs";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

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
    robots: { index: true, follow: true },
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
  const facetJobsHref = careerHubJobsHref(hub);

  return (
    <main data-testid={`career-hub-${hub.slug}`} className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Career hub</p>
      <h1 className="mt-3 font-display text-display font-semibold text-foreground">{hub.h1}</h1>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        {hub.intro.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </article>

      <nav aria-label="Related career topics" className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/jobs" className="font-semibold text-brand hover:underline">
          Search live jobs
        </Link>
        {facetJobsHref && (
          <Link href={facetJobsHref} className="font-semibold text-brand hover:underline">
            Search these jobs
          </Link>
        )}
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
    </main>
  );
}

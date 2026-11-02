import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllCareerHubSlugs, getCareerHub } from "@/lib/seo/career-hubs";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { loadHubFacts } from "@/lib/seo/hub-facts";
import { CareerHubBody } from "@/components/seo/CareerHubBody";

// Each hub states live facts (role count, companies, newest roles), so it is rendered per request, not
// baked at build time. A failed search omits those sections; the page itself still renders.
export const dynamic = "force-dynamic";

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

  const facts = await loadHubFacts(hub);
  return <CareerHubBody hub={hub} facts={facts} now={Date.now()} />;
}

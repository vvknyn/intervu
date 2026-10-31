import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DIRECTORY_DESCRIPTION, groupCompaniesByLetter, letterFromSegment, letterPath } from "@/lib/companies/directory-index";
import { companyBoardPath } from "@/lib/companies/paths";
import { SITE_NAME } from "@/lib/seo/constants";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { resolveOpenCounts } from "@/lib/companies/directory-model";
import { openCountLabel } from "@/lib/companies/presentation";
import { listedCompanies } from "@/lib/seo/sitemap-entries";
import { PageTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

export const dynamic = "force-dynamic";

/** The group a URL segment names, or null when no listed company starts with it. */
async function loadGroup(segment: string) {
  const groups = groupCompaniesByLetter(await listedCompanies());
  return groups.find(({ letter }) => letter === letterFromSegment(segment)) ?? null;
}

const heading = (letter: string) => (letter === "#" ? "Companies starting with a digit or symbol" : `Companies starting with ${letter}`);

export async function generateMetadata({ params }: { params: Promise<{ letter: string }> }): Promise<Metadata> {
  const { letter: segment } = await params;
  const group = await loadGroup(segment);
  if (!group) return {};
  const path = letterPath(group.letter);
  return { description: DIRECTORY_DESCRIPTION, ...robotsMetadataFor(path), ...canonicalMetadata(path, heading(group.letter), DIRECTORY_DESCRIPTION) };
}

export default async function CompanyLetterPage({ params }: { params: Promise<{ letter: string }> }) {
  const { letter: segment } = await params;
  const group = await loadGroup(segment);
  if (!group) notFound();
  const counts = await resolveOpenCounts(group.entries.map((c) => c.domain));
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: SITE_NAME, path: "/" },
    { name: "Companies", path: "/co" },
    { name: group.letter, path: letterPath(group.letter) },
  ]);

  return (
    <PageContainer measure="reading" data-testid="company-directory-letter" className="page-top pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <PageTitle>{heading(group.letter)}</PageTitle>
      <p className="mt-3 text-sm text-muted-foreground">{DIRECTORY_DESCRIPTION}</p>
      <ul className="mt-6 columns-1 gap-8 text-sm sm:columns-2 [&>li]:break-inside-avoid [&>li]:py-0.5 [&_span]:text-muted-foreground">
        {group.entries.map(({ domain, name }) => {
          const count = counts.get(domain);
          return (
            <li key={domain}>
              <Link href={companyBoardPath(domain)}>{name}</Link>
              {count && <> <span>{openCountLabel(count)} roles</span></>}
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-sm">
        <Link href="/co" className="text-brand hover:underline">
          All letters
        </Link>
      </p>
    </PageContainer>
  );
}

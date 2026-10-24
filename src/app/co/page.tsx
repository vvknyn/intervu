import type { Metadata } from "next";
import Link from "next/link";
import { DIRECTORY_DESCRIPTION, groupCompaniesByLetter, letterPath } from "@/lib/companies/directory-index";
import { SITE_NAME } from "@/lib/seo/constants";
import { robotsMetadataFor } from "@/lib/seo/indexability";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import { PageTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const PATH = "/co";

// Same reason as sitemap.ts: the company set is fetched per request (its Meilisearch
// read carries its own revalidate), never baked at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: DIRECTORY_DESCRIPTION,
  ...robotsMetadataFor(PATH),
  ...canonicalMetadata(PATH, "Companies hiring", DIRECTORY_DESCRIPTION),
};

export default async function CompanyDirectoryPage() {
  const groups = groupCompaniesByLetter(await resolveIndexableCompanies());
  if (groups.length === 0) throw new Error("/co: no companies to list");

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: SITE_NAME, path: "/" },
    { name: "Companies", path: PATH },
  ]);

  return (
    <PageContainer measure="reading" data-testid="company-directory" className="py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <PageTitle>Companies hiring</PageTitle>
      <p className="mt-3 text-sm text-muted-foreground">{DIRECTORY_DESCRIPTION}</p>
      <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {groups.map(({ letter, entries }) => (
          <li key={letter}>
            <Link href={letterPath(letter)} className="font-semibold text-brand hover:underline">
              {letter}
            </Link>{" "}
            <span className="text-muted-foreground">{entries.length} companies</span>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

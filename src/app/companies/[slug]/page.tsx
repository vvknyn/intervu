import type { Metadata } from "next";
import { fetchCompanyProfile } from "@/lib/companies/company-stats";
import { companyFromSlug } from "@/lib/companies/paths";
import { CompanyHeader } from "@/components/company/CompanyHeader";
import { CompanyGhostMixBand } from "@/components/company/CompanyGhostMixBand";
import { CompanyFreshnessBand } from "@/components/company/CompanyFreshnessBand";
import { CompanyRolesList } from "@/components/company/CompanyRolesList";

/**
 * Per-company truth page — live roles, ghost mix, posting freshness, all
 * from scraped hiring data. `fetchCompanyProfile` batches everything the page
 * needs into one Meilisearch round trip (see company-stats.ts); this file
 * only renders what comes back.
 *
 * Build-safety posture matches `/trends`: never fail the build on a Meili
 * error (`fetchCompanyProfile` degrades to `null` during the build
 * prerender). `revalidate` states the intended ISR window; whether Next
 * actually serves this route from the ISR cache depends on `searchMeili`
 * (meilisearch.ts) using `cache: "no-store"` on every request — the same
 * caveat `/companies/hiring` already lives with (also declares `revalidate`,
 * also renders dynamic — confirmed in the build's route table) — because
 * `meiliMultiSearch`, the one Meili entry point that honors `next.revalidate`
 * (see /trends' `market-trends.ts`), is aggregation-only and can't fetch the
 * actual job hits this page's roles list needs.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const name = companyFromSlug(slug);
  return {
    title: `${name} — live jobs & hiring truth · Intervu`,
    description: `Live roles, posting freshness, and ghost-job mix for ${name}, from scraped hiring data — not curated.`,
  };
}

export default async function CompanyTruthPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = companyFromSlug(slug);
  const profile = await fetchCompanyProfile(name);

  if (!profile) {
    return (
      <main data-testid="company-truth-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Company data isn&apos;t available right now.</p>
      </main>
    );
  }

  const jobsSearchUrl = `/?q=${encodeURIComponent(profile.name)}`;

  return (
    <main data-testid="company-truth-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <CompanyHeader name={profile.name} totalOpenRoles={profile.totalOpenRoles} />

      {profile.roles.length === 0 ? (
        <p
          className="mt-8 border-t border-foreground pt-6 text-sm text-muted-foreground"
          data-testid="company-empty-state"
        >
          We haven&apos;t verified enough about this company yet.
        </p>
      ) : (
        <>
          <CompanyGhostMixBand ghostMix={profile.ghostMix} />
          <CompanyFreshnessBand freshness={profile.freshness} />
          <CompanyRolesList roles={profile.roles} jobsSearchUrl={jobsSearchUrl} />
        </>
      )}
    </main>
  );
}

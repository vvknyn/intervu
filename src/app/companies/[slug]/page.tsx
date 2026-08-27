import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { domainToSlug } from "@/lib/boards/slug";
import { Button } from "@/components/ui/button";
import { fetchCompanyProfile } from "@/lib/companies/company-stats";
import { companyFromSlug } from "@/lib/companies/paths";
import { CompanyHeader } from "@/components/company/CompanyHeader";
import { CompanyRolesList } from "@/components/company/CompanyRolesList";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";

/**
 * Per-company truth page — live roles from scraped hiring data.
 * `fetchCompanyProfile` batches everything the page needs into one
 * Meilisearch round trip (see company-stats.ts); this file only renders what
 * comes back.
 *
 * Consolidation (P1C, 2026-08-01): `/co/[slug]` (domain-keyed) is the ONE
 * canonical company surface. This name-keyed route is now a RESOLVER —
 * when the matched hits carry a dominant `company_domain`, the page
 * `redirect()`s onto `/co/[slug]` before rendering anything; it only
 * renders its own name-keyed markup below for companies with no known
 * domain. `generateMetadata` runs independently of that decision (it never
 * calls `fetchCompanyProfile`), so a redirecting request still resolves
 * metadata safely — the redirect response just supersedes it.
 *
 * Ghost-mix and posting-freshness bands were removed from this fallback
 * (2026-08-27 receipts audit): both are the gated-receipt class — `/co`
 * locks the same data behind `CompanyIntelGate` (follow-to-unlock) — and a
 * domain-less company has no follow key for that gate to key off, so the
 * only correct move was to stop rendering the receipt here, not to build a
 * gate that cannot exist. `CompanyGhostMixBand` and `CompanyFreshnessBand`
 * are both deleted — this page was each one's only consumer (verified
 * 2026-08-27).
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
    title: `Is ${name} hiring? Live verified jobs & ${GHOST_JOB_TERM} risk`,
    description: `Track live verified job postings and ${GHOST_JOB_TERM} risk signals for ${name} on intervu.`,
    robots: { index: false, follow: true },
    alternates: { canonical: "/jobs" },
  };
}

export default async function CompanyTruthPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = companyFromSlug(slug);
  const profile = await fetchCompanyProfile(name);

  if (profile?.domain) {
    redirect(`/co/${domainToSlug(profile.domain)}`);
  }

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
        <>
          <p
            className="mt-8 border-t border-foreground pt-6 text-sm text-muted-foreground"
            data-testid="company-empty-state"
          >
            We haven&apos;t verified enough about this company yet.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={jobsSearchUrl}>Search jobs mentioning {profile.name}</Link>
          </Button>
        </>
      ) : (
        <CompanyRolesList roles={profile.roles} jobsSearchUrl={jobsSearchUrl} now={Date.now()} />
      )}
    </main>
  );
}

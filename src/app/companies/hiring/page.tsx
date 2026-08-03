import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FollowButton } from "@/components/companies/FollowButton";
import { CompanyInitialTile } from "@/components/jobs/CompanyLogo";
import { getHotCompaniesList, type HotCompanyRow } from "@/lib/companies/hot-list";
import { companyPagePath } from "@/lib/companies/paths";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Companies hiring hard",
  description: "Elite companies ranked by roles opened in the last 90 days.",
};

export const revalidate = 3600;

/**
 * TEMPORARILY DOWN — redirected to /jobs 2026-08-02, nav entry removed
 * (nav-tabs.tsx). Two root causes, verified live against meili-box that day:
 *   1. `company_domain` is not in the index's `filterableAttributes`, so
 *      `fetchEliteBoardJobHits`'s `board:"elite"` query errors.
 *   2. WORSE: `company_opened_90d` / `company_open_count` don't exist on the
 *      indexed documents at all yet. Even with (1) fixed, `rankHotCompanies`
 *      would drop every row (it requires `opened90d` to be a number), so the
 *      page would silently rank by whatever order the fetched sample
 *      happened to come back in while its subtitle still claims "Ranked by
 *      roles opened in the last 90 days" — a wrong page that LOOKS correct.
 * Do not just delete the redirect once (1) is fixed — restore it only after
 * BOTH the metric fields are indexed AND `company_domain` is filterable.
 * `HotCompaniesPage` below (the real render tree, `getHotCompaniesList` from
 * `@/lib/companies/hot-list`, still covered by tests/unit/hot-list.test.ts)
 * is kept as a named export rather than deleted — restoring is: change this
 * `export default function HotCompaniesRedirect` back to
 * `export default HotCompaniesPage` and delete the redirect body.
 */
export default function HotCompaniesRedirect() {
  redirect("/jobs");
}

function heatLabel(row: HotCompanyRow): string {
  return typeof row.opened90d === "number" ? `${row.opened90d} opened / 90d` : "—";
}

export async function HotCompaniesPage() {
  const result = await getHotCompaniesList();

  return (
    <div className="elite-signal min-h-[calc(100dvh-3.5rem)] bg-[color:var(--elite-page)]">
      <div className="border-b border-[color:var(--elite-border)] bg-[color:var(--elite-surface)] px-4 py-3 sm:px-6">
        <nav className="mx-auto max-w-[960px] font-mono text-xs text-[color:var(--elite-faint)]">
          <Link href="/" className="text-[color:var(--elite-brand)] hover:underline">
            Find jobs
          </Link>
          {" / "}
          Companies hiring hard
        </nav>
      </div>

      <main data-testid="hot-companies-page" className="mx-auto max-w-[960px] px-4 py-8 pb-16 sm:px-6">
        <header className="mb-7">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">
            Companies hiring hard
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[color:var(--elite-muted)]">
            Ranked by roles opened in the last 90 days — not fundraising.
          </p>
          <p className="mt-1 font-mono text-xs text-[color:var(--elite-faint)]">
            Metric = observed job postings · updated daily · elite board subset
          </p>
        </header>

        {result.status === "unavailable" ? (
          <p className="text-sm text-[color:var(--elite-muted)]" data-testid="hot-companies-unavailable">
            {result.message || SEARCH_UNAVAILABLE_MESSAGE}
          </p>
        ) : result.companies.length === 0 ? (
          <p className="text-sm text-[color:var(--elite-muted)]">No elite companies indexed right now.</p>
        ) : (
          <div className="overflow-hidden border border-[color:var(--elite-border)] bg-[color:var(--elite-card)]">
            <table className="w-full border-collapse">
              <thead className="border-b border-[color:var(--elite-border)] bg-[color:var(--elite-surface)]">
                <tr>
                  <th className="w-12 px-[18px] py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--elite-faint)]">
                    Rank
                  </th>
                  <th className="px-[18px] py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--elite-faint)]">
                    Company
                  </th>
                  <th className="px-[18px] py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--elite-faint)]">
                    Hiring heat
                  </th>
                  <th className="px-[18px] py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--elite-faint)]">
                    Open roles
                  </th>
                  <th className="px-[18px] py-3.5" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {result.companies.map((company, index) => (
                  <HotCompanyTableRow key={company.domain} company={company} rank={index + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function HotCompanyTableRow({ company, rank }: { company: HotCompanyRow; rank: number }) {
  const hot = typeof company.opened90d === "number" && company.opened90d > 0;

  return (
    <tr className="border-b border-[color:var(--elite-rule)] last:border-b-0 hover:bg-[color:var(--elite-surface)]">
      <td className="w-12 px-[18px] py-4">
        <span
          className={cn(
            "font-display text-[18px] font-bold text-[color:var(--elite-faint)]",
            hot && rank <= 3 && "text-[color:var(--elite-brand)]",
          )}
        >
          {rank}
        </span>
      </td>
      <td className="px-[18px] py-4">
        <Link href={`/co/${company.slug}`} className="flex items-center gap-3">
          <CompanyInitialTile
            name={company.name}
            className="h-9 w-9 text-base"
          />
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold">{company.name}</div>
            {company.oneLiner && (
              <div className="mt-0.5 line-clamp-2 max-w-[280px] text-[12.5px] leading-snug text-[color:var(--elite-muted)]">
                {company.oneLiner}
              </div>
            )}
          </div>
        </Link>
        <Link
          href={companyPagePath(company.name)}
          className="mt-1 inline-block text-[11px] text-[color:var(--elite-faint)] underline underline-offset-2 hover:text-[color:var(--elite-brand)]"
        >
          Live roles &amp; ghost mix →
        </Link>
      </td>
      <td className="px-[18px] py-4 font-mono text-[13px]">
        <span className={cn(hot && "font-medium text-[color:var(--elite-brand)]")}>
          {heatLabel(company)}
        </span>
      </td>
      <td className="px-[18px] py-4 font-mono text-[13px] text-[#3E3B30]">{company.openCount}</td>
      <td className="px-[18px] py-4 text-right">
        <FollowButton
          domain={company.domain}
          slug={company.slug}
          displayName={company.name}
          variant="pill"
        />
      </td>
    </tr>
  );
}

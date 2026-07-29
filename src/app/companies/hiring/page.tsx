import type { Metadata } from "next";
import Link from "next/link";
import { FollowButton } from "@/components/companies/FollowButton";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { getHotCompaniesList, type HotCompanyRow } from "@/lib/companies/hot-list";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Companies hiring hard",
  description: "Elite companies ranked by roles opened in the last 90 days.",
};

function heatLabel(row: HotCompanyRow): string {
  return typeof row.opened90d === "number" ? `${row.opened90d} opened / 90d` : "—";
}

export default async function HotCompaniesPage() {
  const result = await getHotCompaniesList();

  return (
    <>
      <div className="border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
        <nav className="mx-auto max-w-4xl font-mono text-xs text-muted-foreground">
          <Link href="/" className="text-brand hover:underline">
            Find jobs
          </Link>
          {" / "}
          Companies hiring hard
        </nav>
      </div>

      <main data-testid="hot-companies-page" className="mx-auto max-w-4xl px-4 py-8 pb-16 sm:px-6">
        <header className="mb-7">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">
            Companies hiring hard
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Ranked by roles opened in the last 90 days — not fundraising.
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Elite board subset · observed job postings
          </p>
        </header>

        {result.status === "unavailable" ? (
          <p className="text-sm text-muted-foreground" data-testid="hot-companies-unavailable">
            {result.message || SEARCH_UNAVAILABLE_MESSAGE}
          </p>
        ) : result.companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No elite companies indexed right now.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-4 py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Company
                  </th>
                  <th className="hidden px-4 py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                    Hiring heat
                  </th>
                  <th className="px-4 py-3.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Open roles
                  </th>
                  <th className="px-4 py-3.5" aria-hidden />
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
    </>
  );
}

function HotCompanyTableRow({ company, rank }: { company: HotCompanyRow; rank: number }) {
  const hot = typeof company.opened90d === "number" && company.opened90d > 0;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/30">
      <td className="px-4 py-4">
        <span
          className={cn(
            "font-display text-lg font-bold text-muted-foreground",
            hot && rank <= 3 && "text-brand",
          )}
        >
          {rank}
        </span>
      </td>
      <td className="px-4 py-4">
        <Link href={`/co/${company.slug}`} className="flex items-center gap-3">
          <CompanyLogo domain={company.domain} name={company.name} size="sm" />
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold">{company.name}</div>
            {company.oneLiner && (
              <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                {company.oneLiner}
              </div>
            )}
            <div className="mt-1 font-mono text-xs text-brand sm:hidden">{heatLabel(company)}</div>
          </div>
        </Link>
      </td>
      <td className="hidden px-4 py-4 font-mono text-[13px] sm:table-cell">
        <span className={cn(hot && "font-medium text-brand")}>{heatLabel(company)}</span>
      </td>
      <td className="px-4 py-4 font-mono text-[13px]">{company.openCount}</td>
      <td className="px-4 py-4 text-right">
        <FollowButton
          domain={company.domain}
          slug={company.slug}
          displayName={company.name}
        />
      </td>
    </tr>
  );
}

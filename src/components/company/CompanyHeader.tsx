import { PageTitle, PageLead } from "@/components/ui/heading";
/** Header band for `/companies/[slug]` — name + a single honest headline
 *  number. Plain font-display/tabular register, matching `TrendsHero`'s
 *  restrained tone rather than the "elite" themed `/co/[slug]` header. */
export function CompanyHeader({ name, totalOpenRoles }: { name: string; totalOpenRoles: number }) {
  const noun = totalOpenRoles === 1 ? "live role" : "live roles";
  return (
    <header data-testid="company-header">
      <PageTitle>{name}</PageTitle>
      <PageLead className="text-foreground">
        {totalOpenRoles.toLocaleString()} {noun} tracked from the company's own postings
      </PageLead>
    </header>
  );
}

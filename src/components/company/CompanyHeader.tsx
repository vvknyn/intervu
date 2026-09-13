/** Header band for `/companies/[slug]` — name + a single honest headline
 *  number. Plain font-display/tabular register, matching `TrendsHero`'s
 *  restrained tone rather than the "elite" themed `/co/[slug]` header. */
export function CompanyHeader({ name, totalOpenRoles }: { name: string; totalOpenRoles: number }) {
  const noun = totalOpenRoles === 1 ? "live role" : "live roles";
  return (
    <header data-testid="company-header">
      <h1 className="font-display text-xl font-semibold text-foreground sm:text-2xl">{name}</h1>
      <p className="mt-1 text-sm text-foreground">
        {totalOpenRoles.toLocaleString()} {noun} tracked from the company&apos;s own postings
      </p>
    </header>
  );
}

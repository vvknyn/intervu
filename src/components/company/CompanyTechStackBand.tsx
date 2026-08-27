import type { TechFacts } from "@/lib/companies/exhaust";

/**
 * Band 8 (gated) — "Hiring infrastructure", at the consumer altitude the
 * design freeze specifies (DC2): the pipeline's tech-fingerprint checks
 * feed a couple of plain sentences and a chip list here, never the 14-check
 * forensic grid (that stays a subspace-only surface).
 */
export function CompanyTechStackBand({
  techStack,
}: {
  techStack: { data: TechFacts; source: string; asOf: string } | null;
}) {
  if (!techStack) return null;
  const { groups, techTier, totalLiveTechs } = techStack.data;
  if (groups.length === 0 && totalLiveTechs == null) return null;

  return (
    <section data-testid="company-tech-stack-band" className="border border-border bg-card px-6 py-6 sm:px-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        What their site runs on
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground">
        {totalLiveTechs != null
          ? `${totalLiveTechs} active tools detected on their site`
          : "Tools detected on their site"}
        {techTier ? ` · ${techTier} tier` : ""}.
      </p>
      {groups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <span key={g} className="border border-border bg-chip px-2.5 py-1 text-[11.5px] text-foreground">
              {g}
            </span>
          ))}
        </div>
      )}
      <p className="mono-data mt-3 text-[11px] text-muted-foreground">{techStack.source}</p>
    </section>
  );
}

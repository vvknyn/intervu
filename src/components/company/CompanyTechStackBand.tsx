import type { ExhaustSection, TechFacts } from "@/lib/companies/exhaust";

/**
 * Band 8 (gated) — "Hiring infrastructure", at the consumer altitude the
 * design freeze specifies (DC2): the pipeline's tech-fingerprint checks
 * feed a couple of plain sentences and a plain word list here, never the 14-check
 * forensic grid (that stays a subspace-only surface).
 */
export function CompanyTechStackBand({
  techStack,
}: {
  techStack: ExhaustSection<TechFacts>;
}) {
  if (!techStack) return null;
  const { groups, techTier, totalLiveTechs } = techStack.data;
  if (groups.length === 0 && totalLiveTechs == null) return null;

  return (
    <section data-testid="company-tech-stack-band" className="border-t border-border pt-6">
      <h2 className="text-base font-semibold leading-snug text-foreground">
        What their site runs on
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground">
        {totalLiveTechs != null
          ? `${totalLiveTechs} active tools detected on their site`
          : "Tools detected on their site"}
        {techTier ? ` · ${techTier} tier` : ""}.
      </p>
      {groups.length > 0 && (
        <p className="mt-3 text-xs text-foreground">{groups.join(" · ")}</p>
      )}
      <p className="mono-data mt-3 text-xs text-muted-foreground">{techStack.label}</p>
    </section>
  );
}

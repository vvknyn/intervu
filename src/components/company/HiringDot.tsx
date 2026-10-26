import type { CompanyHiringAnswer } from "@/lib/companies/presentation";

/** The header's status dot; colour and label both come from `buildCompanyHiringAnswer`'s freshness read. */
export function HiringDot({ dot }: { dot: CompanyHiringAnswer["dot"] }) {
  if (!dot) return null;
  return <span role="img" aria-label={dot.label} className={`h-2 w-2 shrink-0 rounded-pill ${dot.cls}`} />;
}

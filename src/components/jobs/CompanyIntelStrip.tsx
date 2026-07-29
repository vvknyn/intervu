import { formatCompanyIntel, type CompanyIntelFields } from "@/lib/jobs/company-intel";

export function CompanyIntelStrip({ job }: { job: CompanyIntelFields }) {
  const text = formatCompanyIntel(job);
  if (!text) return null;
  return (
    <p className="font-mono text-[11px] text-muted-foreground">{text}</p>
  );
}

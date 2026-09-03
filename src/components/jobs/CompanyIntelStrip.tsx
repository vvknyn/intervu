import { companyIntelSegments, type CompanyIntelFields } from "@/lib/jobs/company-intel";
import { cn } from "@/lib/utils";

export function CompanyIntelStrip({
  job,
  elite = false,
}: {
  job: CompanyIntelFields;
  /** Elite mock footer with hot segments (board=elite). */
  elite?: boolean;
}) {
  const segs = companyIntelSegments(job);
  if (segs.length === 0) return null;

  if (!elite) {
    return (
      <p className="text-xs text-muted-foreground">
        {segs.map((s) => s.text).join(" · ")}
      </p>
    );
  }

  return (
    <div className="elite-intel" data-testid="company-intel">
      {segs.map((seg, i) => (
        <span key={`${seg.text}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="elite-intel-sep" aria-hidden>·</span>}
          <span className={cn(seg.hot && "elite-intel-hot")}>{seg.text}</span>
        </span>
      ))}
    </div>
  );
}

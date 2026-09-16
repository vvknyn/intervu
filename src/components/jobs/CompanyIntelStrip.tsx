import { companyIntelSegments, type CompanyIntelFields } from "@/lib/jobs/company-intel";
import { DotSeparated } from "@/components/ui/dot-separated";
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
      <DotSeparated
        items={segs.map((seg, i) => (
          <span key={`${seg.text}-${i}`} className={cn(seg.hot && "elite-intel-hot")}>{seg.text}</span>
        ))}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { MetaLine } from "@/components/jobs/JobDetail";
import { MatchChip } from "@/components/jobs/MatchChip";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { cn } from "@/lib/utils";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import {
  LOCATION_UNKNOWN_TEXT,
  decodeText,
  postedAgeShort,
  rowExceptionMeta,
  titleCaseDisplay,
} from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";

const ROW_CLASS =
  "flex w-full text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CompanyJobRowMeta({ job }: { job: PublicJob }) {
  const presented = presentJob(job);
  // Same as JobCard: location stays plain because work-type is its own
  // fact chip — folding the mode into the place string would say Hybrid
  // / Remote twice on one line.
  const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
  const location = locationKnown ? presented.location : null;
  const factChips = buildFactChips(job, null, null).filter(
    (chip) => chip.kind === "work_type" || chip.kind === "salary",
  );

  if (!location && factChips.length === 0) return null;

  return (
    <div className="mt-1 text-sm text-muted-foreground">
      <MetaLine
        items={[
          location ? <span key="location">{location}</span> : null,
          ...factChips.map((chip) => (
            <span
              key={chip.kind}
              className={cn(chip.kind === "salary" && "font-semibold text-foreground")}
            >
              {chip.label}
            </span>
          )),
        ]}
      />
    </div>
  );
}

function CompanyJobRowContent({
  job,
  now,
  matchScore,
  matchAsOfDate,
}: {
  job: PublicJob;
  now: number;
  matchScore?: MatchScore | null;
  matchAsOfDate?: string | null;
}) {
  const exception = rowExceptionMeta(job, now);
  const age = postedAgeShort(derivePostedTs(job), now);

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3">
      <div className="min-w-0">
        <span className="text-lg leading-snug font-semibold text-foreground group-hover:text-brand transition-colors">
          {titleCaseDisplay(decodeText(job.title))}
        </span>
        <CompanyJobRowMeta job={job} />
        {exception ? (
          <div className="mt-1.5 text-xs text-muted-foreground">{exception.label}</div>
        ) : null}
      </div>
      {(matchScore || age) && (
        <span className="flex h-fit flex-col items-end gap-1 self-start shrink-0">
          {matchScore ? (
            <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
          ) : null}
          {age ? (
            <span className="mono-data text-xs leading-none text-muted-foreground">{age}</span>
          ) : null}
        </span>
      )}
    </div>
  );
}

export function CompanyJobRowButton({
  job,
  now,
  matchScore,
  matchAsOfDate,
  onClick,
}: {
  job: PublicJob;
  now: number;
  matchScore?: MatchScore | null;
  matchAsOfDate?: string | null;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(ROW_CLASS, "group cursor-pointer")}>
      <CompanyJobRowContent job={job} now={now} matchScore={matchScore} matchAsOfDate={matchAsOfDate} />
    </button>
  );
}

export function CompanyJobRowLink({
  job,
  now,
  href,
}: {
  job: PublicJob;
  now: number;
  href: string;
}) {
  return (
    <Link href={href} className={cn(ROW_CLASS, "group")}>
      <CompanyJobRowContent job={job} now={now} />
    </Link>
  );
}

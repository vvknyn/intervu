"use client";

import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react";
import { MetaLine } from "@/components/jobs/job-detail-primitives";
import { MatchChip } from "@/components/jobs/MatchChip";
import { jobCompanyHref } from "@/lib/companies/paths";
import { jobPath } from "@/lib/jobs/job-slug";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { displayCompanyBrand, LOCATION_UNKNOWN_TEXT, postedAgeShort } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";
import { cn } from "@/lib/utils";

export interface EmployerMoreRole {
    job: PublicJob;
    score: MatchScore | null;
}

/**
 * The rest of one employer's slot in a list that recommends (`collapseByEmployer`): the employer's other roles that
 * made the list, each with the fit label it has everywhere else, its place and its age, each opening its own page.
 * `hidden` roles past the slot's cap are counted and the employer's page lists them. A control, closed in Today's
 * rows so a list of employers stays a list of employers, open on the deck's card where the person is reading one.
 */
export function EmployerMore({
    lead,
    roles,
    hidden,
    nowMs,
    defaultOpen = false,
    testId = "employer-more",
    className,
}: {
    /** The role that leads the slot: names the employer and links its page. */
    lead: PublicJob;
    roles: readonly EmployerMoreRole[];
    hidden: number;
    nowMs: number;
    defaultOpen?: boolean;
    testId?: string;
    className?: string;
}) {
    const total = roles.length + hidden;
    if (total <= 0) return null;
    const employer = displayCompanyBrand(lead.company, lead.company_domain, lead.title) || "this employer";
    return (
        <details open={defaultOpen} data-testid={testId} className={cn("group/employer-more text-sm", className)}>
            <summary
                data-testid={`${testId}-toggle`}
                className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-ctl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden"
            >
                <CaretDown size={16} weight="bold" aria-hidden className="transition-transform group-open/employer-more:rotate-180" />
                <span>
                    {total} more at {employer}
                </span>
            </summary>
            <ul className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
                {roles.map(({ job, score }) => {
                    const presented = presentJob(job);
                    const placeKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
                    const age = postedAgeShort(derivePostedTs(job), nowMs);
                    return (
                        <li key={job.id} data-testid={`${testId}-role`} data-job-id={job.id} className="min-w-0">
                            <Link href={jobPath(job)} className="line-clamp-2 font-normal text-foreground hover:underline">
                                {presented.title}
                            </Link>
                            <div className="flex flex-wrap items-baseline text-muted-foreground">
                                <MetaLine
                                    items={[
                                        score && <MatchChip key="fit" score={score} jobId={job.id} variant="text" testId={null} />,
                                        placeKnown && <span key="place">{presented.location}</span>,
                                        age && (
                                            <span key="age" className="tabular-nums">
                                                {age}
                                            </span>
                                        ),
                                    ]}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
            {hidden > 0 ? (
                <Link
                    href={jobCompanyHref(lead.company ?? employer, lead.company_domain)}
                    data-testid={`${testId}-all`}
                    className="mt-2 inline-block text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                    See the other {hidden} at {employer}
                </Link>
            ) : null}
        </details>
    );
}

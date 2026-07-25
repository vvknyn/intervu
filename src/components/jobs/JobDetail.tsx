"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowSquareOut, Briefcase, CaretRight, Check, CurrencyDollar, Lightning, MapPin, ShieldCheck, Sparkle, Target, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, prettyEnum, decodeText, cleanCompany, locationText, salaryText, shortDate } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";

/**
 * The job detail panel — everything we know about one posting.
 *
 * Lifted out of app/page.tsx, which was its only caller while `/` was the only
 * surface that could open a posting. A pursuit (/yours/[id]) now opens the same
 * panel, and a second copy of this would be a second place for the verdict
 * banner, the freshness disclosure and the CTA rules to drift. Presentation
 * helpers it shares with the ledger row live in lib/jobs/presentation.
 *
 * `now` is threaded in by the caller rather than sampled here: this renders
 * from a render body, where a clock read is the impure-render class that
 * react-hooks/purity flags.
 */

/** Render structured description blocks (heading / para / list). Descriptions
 *  arrive flattened from the Subspace feed; `formatDescription` reconstructs
 *  the structure. See lib/jobs/format-description.ts. */
function JobDescription({ blocks }: { blocks: DescBlock[] }) {
    return (
        <div className="text-[13.5px] leading-relaxed text-muted-foreground">
            {blocks.map((b, i) => {
                if (b.type === "heading") {
                    return (
                        <h4
                            key={i}
                            className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground first:mt-0"
                        >
                            {b.text}
                        </h4>
                    );
                }
                if (b.type === "list") {
                    return (
                        <ul key={i} className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
                            {(b.items ?? []).map((it, j) => (
                                <li key={j}>{it}</li>
                            ))}
                        </ul>
                    );
                }
                return (
                    <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
                        {b.text}
                    </p>
                );
            })}
        </div>
    );
}

export function JobDetail({
    job,
    now,
    onTailor,
    onOpenPosting,
    onMarkApplied,
    onPrep,
    onGoAfter,
    applied,
    applying,
    pursuit,
    goingAfter,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    onTailor: () => void;
    onOpenPosting: () => void;
    onMarkApplied: () => void;
    onPrep: () => void;
    onGoAfter: () => void;
    applied: boolean;
    applying: boolean;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
}) {
    const staleCheck = checkFreshness(job.updated_at, now) === "stale";
    const ghost = ghostMetaFor(job.ghost_badge, staleCheck);
    // S2 — HONESTY RULE: the row badge states a fact ("Fresh"/"Relisted");
    // this facts line is where the underlying dates it's based on live.
    const freshness = classifyPostingFreshness(job, now);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), now) : null;
    const [descExpanded, setDescExpanded] = useState(false);
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    // Long descriptions are clamped behind a "Show more" toggle so the sticky
    // detail panel doesn't run thousands of pixels tall.
    const collapsible = (job.description?.length ?? 0) > 700;
    const facts: { icon: React.ReactNode; label: string }[] = [];
    if (prettyEnum(job.work_type)) facts.push({ icon: <MapPin size={13} />, label: prettyEnum(job.work_type) });
    if (prettyEnum(job.employment_type))
        facts.push({ icon: <Briefcase size={13} />, label: prettyEnum(job.employment_type) });
    if (prettyEnum(job.experience_level))
        facts.push({ icon: <Target size={13} />, label: prettyEnum(job.experience_level) });
    const sal = salaryText(job);
    if (sal) facts.push({ icon: <CurrencyDollar size={13} />, label: sal });

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-bold leading-tight tracking-tight">{decodeText(job.title)}</h2>
                        <div className="mt-1 text-sm text-muted-foreground">
                            {cleanCompany(job.company) || "Unknown company"} · {locationText(job)}
                        </div>
                        {(postedRelative || firstSeenRelative) && (
                            <div className="mt-1 text-sm text-muted-foreground">
                                {[
                                    postedRelative ? `Posted ${postedRelative}` : null,
                                    firstSeenRelative ? `First seen by us ${firstSeenRelative}` : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                {freshness.kind === "relisted" && freshness.postedMs != null && firstSeenRelative && (
                                    <div className="mt-0.5">
                                        Listed as new on {shortDate(freshness.postedMs)}, but this role first
                                        appeared {firstSeenRelative} — often a repost.
                                    </div>
                                )}
                            </div>
                        )}
                        {facts.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {facts.map((f, i) => (
                                    <span
                                        key={i}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                                    >
                                        {f.icon}
                                        {f.label}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                    {/* The one verb (spec §2/§3): "Go after this job" is the primary
                        action. Once a pursuit exists, it becomes a quiet confirmation
                        link instead — pressing it again would be meaningless. */}
                    {pursuit ? (
                        <Link
                            href={`/yours/${pursuit.id}`}
                            className="text-sm font-medium text-brand hover:underline"
                        >
                            In Yours ✓ — view
                        </Link>
                    ) : (
                        <Button onClick={onGoAfter} disabled={goingAfter} className="gap-2">
                            <Check size={16} weight="bold" />
                            {goingAfter ? "Saving…" : "Go after this job"}
                        </Button>
                    )}
                    <Button variant="outline" onClick={onTailor} className="gap-2">
                        <Sparkle size={16} weight="fill" />
                        Apply with tailored resume
                    </Button>
                    {job.apply_url && (
                        <Button variant="outline" onClick={onOpenPosting} className="gap-2">
                            <ArrowSquareOut size={16} />
                            Open posting
                        </Button>
                    )}
                    <Button variant="outline" onClick={onMarkApplied} disabled={applied || applying} className="gap-2">
                        <Check size={16} />
                        {applied ? "Tracked" : applying ? "Saving…" : "Mark as applied"}
                    </Button>
                </div>
            </div>

            <div className="p-6">
                {ghost && (
                    <div className={cn("mb-5 flex items-start gap-2.5 rounded-xl border p-3.5", ghost.cls)}>
                        {job.ghost_badge === "clear" && !staleCheck ? (
                            <ShieldCheck size={18} className="mt-0.5 shrink-0" weight="fill" />
                        ) : (
                            <WarningCircle size={18} className="mt-0.5 shrink-0" weight="fill" />
                        )}
                        <div>
                            <div className="text-[13px] font-semibold">{ghost.label}</div>
                            <div className="mt-0.5 text-xs leading-relaxed opacity-90">{ghost.explain}</div>
                        </div>
                    </div>
                )}

                <div className="mb-5">
                    <div className="mb-2 text-[13px] font-semibold">About this role</div>
                    {blocks.length > 0 ? (
                        <>
                            <div className={cn("relative", collapsible && !descExpanded && "max-h-[20rem] overflow-hidden")}>
                                <JobDescription blocks={blocks} />
                                {collapsible && !descExpanded && (
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                                )}
                            </div>
                            {collapsible && (
                                <button
                                    onClick={() => setDescExpanded((v) => !v)}
                                    className="mt-2 text-xs font-medium text-brand hover:underline"
                                >
                                    {descExpanded ? "Show less" : "Show full description"}
                                </button>
                            )}
                        </>
                    ) : (
                        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
                            No description was captured for this role.{" "}
                            {job.apply_url ? (
                                <>
                                    Use <span className="font-medium text-foreground">Open posting</span> to read the
                                    full details on the employer&apos;s site.
                                </>
                            ) : (
                                "Try the original posting for full details."
                            )}
                        </div>
                    )}
                </div>

                {job.tags && job.tags.length > 0 && (
                    <>
                        <div className="mb-2.5 text-[13px] font-semibold">Keywords from the posting</div>
                        <div className="flex flex-wrap gap-2">
                            {job.tags.slice(0, 16).map((tag) => (
                                <span
                                    key={tag}
                                    className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                                >
                                    {decodeText(tag)}
                                </span>
                            ))}
                        </div>
                    </>
                )}

                <button
                    onClick={onPrep}
                    className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                    <Lightning size={14} weight="fill" />
                    Prep for interview at {cleanCompany(job.company) || "this company"}
                    <CaretRight size={13} />
                </button>
            </div>
        </div>
    );
}

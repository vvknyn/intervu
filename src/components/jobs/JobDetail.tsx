"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowSquareOut, Briefcase, CalendarBlank, CaretRight, Check, CurrencyDollar, Eye, Lightning, MapPin, ShieldCheck, Sparkle, Target, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { buildFactChips, ghostCheckedText, type FactChipKind } from "@/components/jobs/job-detail-facts";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, decodeText, cleanCompany, locationText, shortDate } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";

/**
 * Icon per fact-chip kind (`FactChipKind`, job-detail-facts.ts) — the only
 * piece of chip presentation that stays here rather than in the pure
 * helper, since a JSX element isn't something a `node:test` file can assert
 * on cheaply. Keyed on the chip's own `kind` (not enumerated per-job-field
 * at the render site) so a new chip kind is wired by adding one entry here
 * and one branch in `buildFactChips`, not by touching the render loop.
 */
const FACT_CHIP_ICON: Record<FactChipKind, React.ReactNode> = {
    work_type: <MapPin size={13} />,
    employment_type: <Briefcase size={13} />,
    experience_level: <Target size={13} />,
    salary: <CurrencyDollar size={13} />,
    posted: <CalendarBlank size={13} />,
    first_seen: <Eye size={13} />,
};

/**
 * TODO(companyPagePath contract): a parallel workstream owns
 * `@/lib/companies/paths` exporting `companyPagePath(company: string):
 * string`. That module hadn't landed in this worktree as of 2026-08-01, so
 * this duplicates its documented interim shape rather than statically
 * importing a module that may not exist yet (which would break the build
 * for everyone until landing order lined up). Swap the one call site below
 * for the real import once it lands — no other change needed.
 */
function companyHref(company: string): string {
    return `/companies/${encodeURIComponent(company)}`;
}

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
    // Structured facts row (Deliverable 1, 2026-08-01) — consolidates what
    // used to be a separate "Posted X · First seen by us Y" prose line plus
    // this chip row into ONE scannable row; see buildFactChips for the
    // per-field include/omit decision (kept pure + unit-tested there).
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    const cleanedCompany = cleanCompany(job.company);

    return (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-bold leading-tight tracking-tight">{decodeText(job.title)}</h2>
                        <div className="mt-1 text-sm text-muted-foreground">
                            {cleanedCompany ? (
                                <Link href={companyHref(cleanedCompany)} className="hover:text-foreground hover:underline">
                                    {cleanedCompany}
                                </Link>
                            ) : (
                                "Unknown company"
                            )}{" "}
                            · {locationText(job)}
                        </div>
                        {freshness.kind === "relisted" && freshness.postedMs != null && firstSeenRelative && (
                            <div className="mt-1 text-sm text-muted-foreground">
                                Listed as new on {shortDate(freshness.postedMs)}, but this role first appeared{" "}
                                {firstSeenRelative} — often a repost.
                            </div>
                        )}
                        {chips.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {chips.map((c) => (
                                    <span
                                        key={c.kind}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                                    >
                                        {FACT_CHIP_ICON[c.kind]}
                                        {c.label}
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
                        <Button
                            onClick={onGoAfter}
                            disabled={goingAfter}
                            className="gap-2 bg-foreground text-background hover:bg-foreground/90"
                        >
                            <Check size={16} weight="bold" />
                            {goingAfter ? "Saving…" : "Go after this job"}
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        onClick={onTailor}
                        className="gap-2 border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
                    >
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
                    {/* Promoted out of the bottom of the panel (2026-08-01) — prep is a
                        primary next step, not a footnote past the description. Same
                        text-link styling as before, just relocated into the CTA row. */}
                    <button
                        onClick={onPrep}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                    >
                        <Lightning size={14} weight="fill" />
                        Prep for interview at {cleanedCompany || "this company"}
                        <CaretRight size={13} />
                    </button>
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
                            {/* WHEN this verdict was last checked — a stated fact from
                                `updated_at`, not a fabricated checklist of what was
                                inspected (see ghostCheckedText's doc comment). Makes the
                                "hasn't been re-checked recently" claim above concrete
                                instead of vague, on every ghost-badge state, not just the
                                stale-clear one. */}
                            <div className="mt-1 text-[11px] font-medium opacity-70">
                                {ghostCheckedText(job.updated_at, now)}
                            </div>
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
            </div>
        </div>
    );
}

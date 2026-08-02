"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowSquareOut, Check, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { buildFactChips, deriveGhostSignals, ghostCheckedText, alsoInLabel, type FactChipKind } from "@/components/jobs/job-detail-facts";
import { jobCompanyHref } from "@/lib/companies/paths";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, decodeText, cleanCompany, locationText, shortDate } from "@/lib/jobs/presentation";
import { countryToFlag } from "@/lib/jobs/country-flag";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";

/**
 * Short mono "key" label per fact-chip kind (`FactChipKind`,
 * job-detail-facts.ts) — the squared design-system pass (docs-mockup.html
 * Comp B2) renders each fact as a bordered `key value` box (mono, no icon)
 * rather than an icon + prose pill. Kept here rather than in the pure
 * helper for the same reason the icon map it replaces was: presentation,
 * not a decision `buildFactChips` needs to be tested on.
 */
const FACT_CHIP_KEY: Record<FactChipKind, string> = {
    work_type: "workplace",
    employment_type: "type",
    experience_level: "level",
    salary: "salary",
    posted: "posted",
    first_seen: "first seen by us",
};

/** `buildFactChips`' posted/first_seen labels already embed the verb
 *  ("Posted 3d ago") for the icon-based chip this replaces; the squared
 *  `.fact` box states that verb as the key instead, so it's stripped here
 *  to avoid rendering it twice ("first seen by us" + "First seen 10d ago"). */
function factValue(kind: FactChipKind, label: string): string {
    return kind === "posted" || kind === "first_seen" ? label.replace(/^(Posted|First seen)\s+/i, "") : label;
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
                        {b.lead && <strong className="text-foreground">{b.lead} </strong>}
                        {b.text}
                    </p>
                );
            })}
        </div>
    );
}

/**
 * Detail-panel loading placeholder (Job 1b, 2026-08-01) — shown by app/page.tsx
 * in place of `<JobDetail>` for the one real gap in the desktop aside / mobile
 * sheet's job-resolution chain: a deep-linked `?job=` id whose first search
 * page hasn't resolved yet, so neither `selected` nor the dead-link existence
 * check has an answer (that check's own in-flight state already renders its
 * own spinner via `DeadJobUnresolved`, a distinct, later state). Exported
 * from here rather than duplicated in page.tsx so the skeleton's shape (title
 * bar, chips row, action row, paragraph bars) stays next to the real layout
 * it mirrors — one place to keep both in sync. `.skeleton-bar` (globals.css)
 * carries the shimmer sweep and is disabled under `prefers-reduced-motion` by
 * the existing site-wide animation-neutralizing rule there.
 */
export function JobDetailSkeleton() {
    return (
        <div className="overflow-hidden border border-border bg-card" aria-hidden="true">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <div className="skeleton-bar h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2.5">
                        <div className="skeleton-bar h-5 w-2/3" />
                        <div className="skeleton-bar h-3.5 w-1/3" />
                        <div className="flex flex-wrap gap-2 pt-1">
                            <div className="skeleton-bar h-5 w-20" />
                            <div className="skeleton-bar h-5 w-24" />
                            <div className="skeleton-bar h-5 w-16" />
                        </div>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    <div className="skeleton-bar h-9 w-40" />
                    <div className="skeleton-bar h-9 w-48" />
                    <div className="skeleton-bar h-9 w-32" />
                </div>
            </div>
            <div className="space-y-2.5 p-6">
                <div className="skeleton-bar h-3.5 w-full" />
                <div className="skeleton-bar h-3.5 w-full" />
                <div className="skeleton-bar h-3.5 w-5/6" />
                <div className="skeleton-bar h-3.5 w-2/3" />
            </div>
        </div>
    );
}

/**
 * Bottom CTA row for an open job detail — the ONE place this renders (P27
 * mobile pass, Task "sticky mobile action bar"). Previously two near-identical
 * hand-copies lived in app/page.tsx (the desktop aside and the mobile sheet),
 * which is how a duplicate like this drifts; both callers now render this
 * instead, and `/yours/[id]`'s sheet — which had no action bar at all — picks
 * one up for free by rendering it too.
 *
 * Two responsive presentations, one component:
 *  - **Mobile (<lg):** `fixed` to the viewport, escaping whatever scroll
 *    container it's nested in (the job-detail Sheet's own `overflow-y-auto`),
 *    so it stays pinned in the thumb zone while the description scrolls
 *    underneath. Offset by `--mobile-tabbar-h` (globals.css) + the iOS safe
 *    area so it stacks ABOVE `MobileTabBar` rather than fighting it for the
 *    same fixed `bottom-0` — deliberate: both are `lg:hidden` and can render
 *    at the same time (MobileTabBar has no route-based reason to hide while
 *    a job sheet is open), so this can't assume the sheet alone keeps them
 *    apart. Primary is "Apply" (reuses `onOpenPosting` — the exact handler
 *    the SERP card's own "Apply" button calls, `app/page.tsx`'s
 *    `handleOpenPosting`, which already funnels a signed-out tap through the
 *    existing `gate` pending-action instead of a new one); secondary is
 *    Apply only — mobile's "Am I a fit?" button was removed 2026-08-02 (AI
 *    intelligence moved to MCP; a sticky bar is too tight for a handoff
 *    line, so this degrades by omission rather than growing a note).
 *  - **Desktop (lg+):** unchanged from before — `sticky bottom-0` footer of
 *    the scrolling aside panel, Apply only (Prep removed 2026-08-02). The
 *    aside only ever mounts at lg+ (`isDesktop && selectedId` in page.tsx),
 *    so the `lg:` overrides
 *    below are belt-and-suspenders there, not load-bearing.
 */
export function JobDetailActionBar({
    job,
    onOpenPosting,
}: {
    job: PublicJob;
    onOpenPosting: () => void;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
}) {
    // `fixed` (mobile) takes the bar out of the scrolling sheet's normal flow
    // entirely, unlike the old `sticky` bar it replaced — which reserved its
    // own space just by being an in-flow box. Without compensating for that,
    // a fully-scrolled long description's tail ends up drawn UNDER the
    // opaque bar instead of above it (caught visually during the P27 mobile
    // pass, verified against a real Meilisearch-shaped fixture: the last
    // content pixel needs to clear not just the bar's own height but ALSO
    // the `--mobile-tabbar-h` gap it sits above — scrolled to its natural
    // max, content's last pixel lands at the true screen bottom, i.e. behind
    // BOTH). The fix: measure the bar's own rendered height (ResizeObserver,
    // same pattern as TourOverlay's card-height measure) and render an
    // invisible flow spacer of `barHeight + that same gap` right before it,
    // reusing the identical `--mobile-tabbar-h`/safe-area calc the bar's own
    // `bottom` offset uses so the two can't drift apart. Self-adjusting if
    // the bar's content ever wraps to a second line. Desktop's `lg:sticky`
    // bar needs none of this (already in-flow), hence `lg:hidden`.
    const barRef = useRef<HTMLDivElement>(null);
    const [barHeight, setBarHeight] = useState(0);
    useEffect(() => {
        const el = barRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setBarHeight(entry.contentRect.height);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <>
            <div
                aria-hidden
                className="lg:hidden"
                style={{ height: `calc(${barHeight}px + var(--mobile-tabbar-h, 0px) + env(safe-area-inset-bottom, 0px))` }}
            />
            <div
                ref={barRef}
                data-testid="job-detail-action-bar"
                className={cn(
                    "z-20 flex gap-2 border-t border-border bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/80",
                    "fixed inset-x-0 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px))] lg:sticky lg:inset-x-auto lg:bottom-0",
                )}
            >
                {job.apply_url && (
                    <Button variant="outline" className="h-11 flex-1 gap-1.5 lg:h-9" onClick={onOpenPosting}>
                        <ArrowSquareOut size={16} />
                        Apply
                    </Button>
                )}
            </div>
        </>
    );
}

export function JobDetail({
    job,
    now,
    onOpenPosting,
    onMarkApplied,
    onGoAfter,
    applied,
    applying,
    pursuit,
    goingAfter,
    variants = [],
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    onOpenPosting: () => void;
    onMarkApplied: () => void;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites.
     *  JobDetail itself now renders a static line instead of calling this. */
    onPrep?: () => void;
    onGoAfter: () => void;
    applied: boolean;
    applying: boolean;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    /** This job's OTHER cluster variants (same normalized title + company,
     *  different location — `lib/jobs/cluster.ts`) — feeds the header's
     *  "also in" chip. Empty for the ordinary non-clustered case. */
    variants?: PublicJob[];
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
    // Himalayas-style flag chip (visual-identity pass) — see JobCard's
    // matching comment in app/page.tsx for the null-safety rationale.
    const countryFlag = countryToFlag(job.location_country);
    const alsoIn = alsoInLabel(job, variants);
    // EXPANDED ghost module (docs-mockup.html Comp B2) — honest, derived
    // signal list; see deriveGhostSignals's doc comment for why each line
    // reuses an existing single source instead of new inferred logic.
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, now);
    const checkedText = ghostCheckedText(job.updated_at, now);
    const hasCompanyIntel =
        typeof job.company_open_count === "number" ||
        (typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number");

    return (
        <div className="overflow-hidden border border-border bg-card">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-bold leading-tight tracking-tight">{decodeText(job.title)}</h2>
                        <div className="mt-1 text-sm text-muted-foreground">
                            {cleanedCompany ? (
                                <Link href={jobCompanyHref(cleanedCompany, job.company_domain)} className="hover:text-foreground hover:underline">
                                    {cleanedCompany}
                                </Link>
                            ) : (
                                "Unknown company"
                            )}{" "}
                            ·{" "}
                            {countryFlag && (
                                <span aria-hidden className="mr-1">
                                    {countryFlag}
                                </span>
                            )}
                            {locationText(job)}
                        </div>
                        {freshness.kind === "relisted" && freshness.postedMs != null && firstSeenRelative && (
                            <div className="mt-1 text-sm text-muted-foreground">
                                Listed as new on {shortDate(freshness.postedMs)}, but this role first appeared{" "}
                                {firstSeenRelative} — often a repost.
                            </div>
                        )}
                        {/* Full facts row (docs-mockup.html Comp B2) — squared
                            `key value` boxes, mono throughout (THE RULES #4),
                            plus the green "also in" cluster-variant fact when
                            this posting has duplicates at other locations. */}
                        {(chips.length > 0 || alsoIn) && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {chips.map((c) => (
                                    <span
                                        key={c.kind}
                                        className="mono-data inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground"
                                    >
                                        <b className="font-medium text-muted-foreground">{FACT_CHIP_KEY[c.kind]}</b>
                                        {/* "First seen by us…" — the one chip that underwrites a
                                            verified corpus fact, so it alone carries the signature
                                            underline (see globals.css's .verified-underline doc). */}
                                        <span className={c.kind === "first_seen" ? "verified-underline" : undefined}>
                                            {factValue(c.kind, c.label)}
                                        </span>
                                    </span>
                                ))}
                                {alsoIn && (
                                    <span className={cn(chipVariants({ active: true }), "mono-data h-auto py-1.5 text-[12px]")}>
                                        <b className="font-medium">also in</b>
                                        {alsoIn}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Primary action row (docs-mockup.html Comp B2): Apply ink /
                    Save quiet — the two-weight subset of the button family
                    (THE RULES #3) that's left once "Am I a fit?" moved to
                    MCP (2026-08-02, see the McpHandoffNote in the "How you
                    match" rail below — the header row itself degrades by
                    omission rather than repeating that line up here). Prep
                    removed 2026-08-02 — see the static note below this row
                    instead of a button. */}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                    {job.apply_url && (
                        <Button onClick={onOpenPosting} className="gap-2">
                            <ArrowSquareOut size={16} />
                            Apply
                        </Button>
                    )}
                    {/* The one verb (spec §2/§3): "Save" is the primary save
                        action. Once a pursuit exists, it becomes a quiet
                        confirmation link instead — pressing it again would
                        be meaningless. */}
                    {pursuit ? (
                        <Link
                            href={`/yours/${pursuit.id}`}
                            className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-4 text-sm font-medium text-brand hover:bg-muted/40"
                        >
                            <Check size={16} weight="bold" />
                            Saved ✓
                        </Link>
                    ) : (
                        <Button variant="quiet" onClick={onGoAfter} disabled={goingAfter} className="gap-2">
                            <Check size={16} />
                            {goingAfter ? "Saving…" : "Save"}
                        </Button>
                    )}
                </div>
                {/* Prep runs in the user's AI (2026-08-02) — this nudge is the
                    pairing funnel's in-context entry point. */}
                <McpHandoffNote variant="prep" className="mt-2.5" />
                {/* "Apply with tailored resume" moved to MCP 2026-08-02 — its
                    line now lives once, in the "How you match" rail below,
                    not repeated here. */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <button
                        onClick={onMarkApplied}
                        disabled={applied || applying}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                    >
                        <Check size={14} />
                        {applied ? "Tracked as applied" : applying ? "Saving…" : "Mark as applied"}
                    </button>
                </div>
            </div>

            <div className="p-6">
                {/* EXPANDED ghost module (docs-mockup.html Comp B2): the
                    verdict headline (unchanged) plus the honest, derived
                    per-signal grid — see deriveGhostSignals's doc comment
                    for what each line reads from and why. */}
                {ghost && (
                    <div className={cn("mb-5 border p-3.5", ghost.cls)}>
                        <div className="flex items-start gap-2.5">
                            {job.ghost_badge === "clear" && !staleCheck ? (
                                <ShieldCheck size={18} className="mt-0.5 shrink-0" weight="fill" />
                            ) : (
                                <WarningCircle size={18} className="mt-0.5 shrink-0" weight="fill" />
                            )}
                            <div>
                                <div className="verified-underline text-[13px] font-semibold">{ghost.label}</div>
                                <div className="mt-0.5 text-xs leading-relaxed opacity-90">{ghost.explain}</div>
                            </div>
                        </div>
                        {ghostSignals.length > 0 && (
                            <div className="mono-data mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 text-[12px] sm:grid-cols-2">
                                {ghostSignals.map((s) => (
                                    <span key={s.text}>
                                        {s.positive ? "✓ " : "— "}
                                        {s.text}
                                    </span>
                                ))}
                            </div>
                        )}
                        {/* WHEN this verdict was last checked — a stated fact from
                            `updated_at`, not a fabricated checklist of what was
                            inspected (see ghostCheckedText's doc comment). */}
                        <div className="verified-underline mono-data mt-2.5 inline-block text-[11px] font-medium opacity-80">
                            every signal automated · {checkedText.charAt(0).toLowerCase()}{checkedText.slice(1)}
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
                        <div className="border border-dashed border-border bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
                            No description was captured for this role.{" "}
                            {job.apply_url ? (
                                <>
                                    Use <span className="font-medium text-foreground">Apply</span> to read the full
                                    details on the employer&apos;s site.
                                </>
                            ) : (
                                "Try the original posting for full details."
                            )}
                        </div>
                    )}
                </div>

                {job.tags && job.tags.length > 0 && (
                    <div className="mb-5">
                        <div className="mb-2.5 text-[13px] font-semibold">Keywords from the posting</div>
                        <div className="flex flex-wrap gap-2">
                            {job.tags.slice(0, 16).map((tag) => (
                                <span
                                    key={tag}
                                    className="mono-data border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                >
                                    {decodeText(tag)}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* "How you match" rail replaced 2026-08-02 — fit assessment,
                    gap analysis, and tailored-resume generation all moved to
                    MCP; this is the ONE line for the whole job-detail pane
                    that says so (the header action row above deliberately
                    doesn't repeat it — see its own comment). */}
                <McpHandoffNote className="mb-5" />

                {/* Company hiring-truth mini-KPI rail (docs-mockup.html Comp
                    B2) — reads the SAME denormalized company_* fields
                    company-intel.ts already reads for the SERP card's intel
                    strip. Degrades by omission: no KPI renders unless its
                    OWN field is present, and the whole module is skipped
                    when none are (never a placeholder zero). */}
                {hasCompanyIntel && (
                    <div className="border border-border bg-background p-4">
                        <div className="mono-data text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {cleanedCompany || "This company"} · hiring truth
                        </div>
                        <div className="mt-3 flex flex-wrap gap-6">
                            {typeof job.company_open_count === "number" && (
                                <div>
                                    <div className="verified-underline mono-data inline-block text-2xl">
                                        {job.company_open_count.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-1.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                                        Live roles
                                    </div>
                                </div>
                            )}
                            {typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number" && (
                                <div>
                                    <div className="verified-underline mono-data inline-block text-2xl">
                                        {job.company_opened_90d.toLocaleString()}/{job.company_closed_90d.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-1.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                                        Opened / closed, 90d
                                    </div>
                                </div>
                            )}
                        </div>
                        {cleanedCompany && (
                            <Button asChild variant="quiet" className="mt-3.5 w-full justify-center">
                                <Link href={jobCompanyHref(cleanedCompany, job.company_domain)}>Company page →</Link>
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ArrowSquareOut, Check, Copy, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { ContextHelp } from "@/components/ui/context-help";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { buildFactChips, deriveExposureBadges, deriveGhostSignals, ghostCheckedText, alsoInLabel, type FactChipKind } from "@/components/jobs/job-detail-facts";
import { jobCompanyHref } from "@/lib/companies/paths";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { buildGuestPreview } from "@/lib/jobs/guest-preview";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, decodeText, displayCompany, locationText, shortDate, salaryText, postedAgeShort } from "@/lib/jobs/presentation";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { STATUS_PILL } from "@/lib/ui/status-tokens";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { getRelatedJobsAction } from "@/actions/jobs";
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
    // "posted" is the EMPLOYER's claimed date (re-stamped on a relist,
    // per posting-freshness.ts) — distinct from "first seen by us" below,
    // which is OUR observation. Labeling both identically read as if they
    // carried equal weight; the key now states whose claim each one is.
    posted: "employer posted",
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
 * Guest gate (G4, Grok UX wave) — the ONE place a signed-out visitor's
 * detail body renders, replacing the old blur-as-paywall overlay. Shows a
 * real, truncated preview of the description (`buildGuestPreview`,
 * lib/jobs/guest-preview.ts — the same HTML/Markdown sanitization
 * `formatDescription` runs for signed-in readers) with a bottom fade and
 * one sign-in CTA line, rather than an opaque "sign in to view this role"
 * promise. Apply/Save stay real, clickable buttons elsewhere in this panel
 * (they already gate at the click handler — see `resolveApplyGateDecision`,
 * jobs/page.tsx) — this component only arbitrates the DESCRIPTION body, so
 * there is exactly one preview-vs-full decision for a guest's detail view,
 * not scattered per-section `!signedIn` checks.
 */
function GuestDescriptionPreview({
    description,
    onRequestSignIn,
}: {
    description: string | null | undefined;
    onRequestSignIn?: () => void;
}) {
    const preview = buildGuestPreview(description);
    return (
        <div className="mb-5">
            <div className="mb-2 text-[13px] font-semibold">About this role</div>
            {preview.text ? (
                <div className={cn("relative", preview.truncated && "max-h-[14rem] overflow-hidden")}>
                    <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground">
                        {preview.text}
                        {preview.truncated && "…"}
                    </p>
                    {preview.truncated && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                    )}
                </div>
            ) : (
                <div className="border border-dashed border-border bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
                    No description was captured for this role.
                </div>
            )}
            <button
                type="button"
                data-testid="job-detail-signin-cta"
                onClick={() => onRequestSignIn?.()}
                className="mt-2.5 text-xs font-medium text-brand hover:underline"
            >
                Sign in to read the full posting
            </button>
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
 * `sticky bottom-0` at every breakpoint — the bar is always rendered as the
 * LAST in-flow child of its caller's own scroll container (the job-detail
 * Sheet's `overflow-y-auto`, app/jobs/page.tsx), so it pins to that
 * container's bottom edge without needing to escape into `fixed` viewport
 * coordinates. `fixed` was tried first (2026-08 P27 pass) so the bar could
 * stack above `MobileTabBar`'s own `fixed bottom-0` nav — but the Sheet
 * paints OVER the tab bar (both are `z-50`), so on mobile a `fixed`,
 * viewport-anchored bar floated ~90px above the true visible bottom with
 * description text showing beneath it (user-reported). `sticky` fixes this
 * by construction: it can never draw outside its own scroll container, so
 * there is no separate "how far above the tab bar" offset to compute, no
 * height to measure, and no invisible flow-spacer needed to reserve its
 * space — being an ordinary in-flow box already does that.
 */
export function JobDetailActionBar({
    job,
    onOpenPosting,
    signedIn = true,
}: {
    job: PublicJob;
    onOpenPosting: () => void;
    /** When false, the apply CTA reads "Sign in to apply" (handler still gates). */
    signedIn?: boolean;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
}) {
    return (
        <div
            data-testid="job-detail-action-bar"
            className="sticky bottom-0 z-20 flex gap-2 border-t border-border bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        >
            {job.apply_url && (
                <Button variant="outline" className="h-11 flex-1 gap-1.5 lg:h-9" onClick={onOpenPosting}>
                    <ArrowSquareOut size={16} />
                    {signedIn ? "Apply" : "Sign in to apply"}
                </Button>
            )}
        </div>
    );
}

/**
 * "Copy link" control for the detail header — visible to guests and
 * signed-in users alike, since job identity is never gated (see the header
 * restructure in `JobDetail` below). Copies the canonical `/jobs?job=<id>`
 * URL rather than `window.location`, because this same panel also renders
 * from `/yours/[id]` (a pursuit-id route, not a job-id one — see this
 * file's module doc comment above). Same copied-state register as
 * `CopyUrlBar` (app/connect/connect-client.tsx): a local timed flag, no
 * toast, no new dependency; a denied/unavailable clipboard degrades to a
 * silent no-op rather than crashing the panel.
 */
function CopyJobLinkButton({ jobId }: { jobId: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            const url = `${window.location.origin}/jobs?job=${encodeURIComponent(jobId)}`;
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard API can be denied (permissions/insecure context) —
            // the control just stays put rather than breaking the panel.
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : "Copy link to this role"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
        >
            {copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
        </button>
    );
}

/**
 * A2 — "More like this" row (Curiosity / Serial Positioning Effect). Not a
 * reuse of the SERP's `JobCard` (jobs/page.tsx): that component is
 * page-local (never exported), tightly coupled to page.tsx-only state
 * (cluster-variant expand/collapse, the verdict badge, the company-nav
 * handler) that a 5-row "more like this" list doesn't need, and importing it
 * here would be a circular import (page.tsx is JobDetail's own caller). What
 * IS reused is the single source of truth for each fact's presentation —
 * `displayCompany`/`locationText`/`salaryText`/`postedAgeShort`
 * (lib/jobs/presentation.ts) — the exact same helpers `JobCard` itself
 * calls, so this row can never format a company name, salary, or age
 * differently than the SERP does.
 */
function RelatedJobRow({ job, now, onClick }: { job: PublicJob; now: number; onClick: () => void }) {
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    const loc = locationText(job);
    return (
        <button
            type="button"
            data-testid="related-job-row"
            onClick={onClick}
            className="flex w-full flex-col gap-0.5 border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-foreground/40"
        >
            <span className="truncate text-[13px] font-medium text-foreground">{decodeText(job.title)}</span>
            <span className="mono-data truncate text-[11px] text-muted-foreground">
                {displayCompany(job.company, job.company_domain) || "Unknown company"}
                {loc ? ` · ${loc}` : ""}
                {age ? ` · ${age}` : ""}
                {salary ? ` · from ${salary}` : ""}
            </span>
        </button>
    );
}

export function JobDetail({
    job,
    now,
    onOpenPosting,
    onGoAfter,
    pursuit,
    goingAfter,
    variants = [],
    onClose,
    className,
    signedIn = true,
    onRequestSignIn,
    onOpenRelated,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    onOpenPosting: () => void;
    /** When false, the description preview is truncated and Apply/Save gate at click (G4, Grok UX wave). */
    signedIn?: boolean;
    /** Opens auth when the guest preview's sign-in CTA is pressed. */
    onRequestSignIn?: () => void;
    /** Accepted-but-unused (prep surface removed 2026-08-02): kept optional
     *  so callers built before the removal — e.g. app/page.tsx, out of this
     *  change's scope — still typecheck without editing their call sites. */
    onPrep?: () => void;
    onGoAfter: () => void;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    /** This job's OTHER cluster variants (same normalized title + company,
     *  different location — `lib/jobs/cluster.ts`) — feeds the header's
     *  "also in" chip. Empty for the ordinary non-clustered case. */
    variants?: PublicJob[];
    onClose?: () => void;
    className?: string;
    /** A2 — "More like this" row click. Absent (rather than defaulted to a
     *  no-op) reads as "no related panel" — see the render guard below —
     *  since a caller that truly can't open a job (none exists here) should
     *  never render rows that silently do nothing on click. */
    onOpenRelated?: (jobId: string) => void;
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
    const cleanedCompany = displayCompany(job.company, job.company_domain);
    // Himalayas-style flag chip (visual-identity pass) — see JobCard's
    // matching comment in app/page.tsx for the null-safety rationale.
    const countryFlag = countryToFlag(job.location_country);
    const alsoIn = alsoInLabel(job, variants);
    // EXPANDED ghost module (docs-mockup.html Comp B2) — honest, derived
    // signal list; see deriveGhostSignals's doc comment for why each line
    // reuses an existing single source instead of new inferred logic.
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, now);
    const checkedText = ghostCheckedText(job.updated_at, now);
    // S4 — exposure trust badges (dark launch): [] for every job until
    // Subspace's upstream backfill lands (see deriveExposureBadges' doc).
    const exposureBadges = deriveExposureBadges(job, now);
    const hasCompanyIntel =
        typeof job.company_open_count === "number" ||
        (typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number");

    // A2 — "More like this." Self-contained: this panel is the only
    // consumer of the related list, so it fetches its own data (via the
    // server action directly, same as any other client component calling
    // a "use server" export) rather than page.tsx threading it through as
    // yet another prop on an already-3000-line file. `cancelled` guards
    // against a fast re-open (new `job.id` before the previous fetch lands)
    // painting a stale job's related list onto the new one.
    const [related, setRelated] = useState<PublicJob[]>([]);
    useEffect(() => {
        let cancelled = false;
        setRelated([]);
        // Guests see this panel blurred behind the sign-in gate — fetching
        // for them would spend up to two corpus queries per detail-open on
        // rows nobody can read.
        if (!signedIn) return;
        getRelatedJobsAction(job.id, job.company_domain, job.title)
            .then((hits) => {
                if (!cancelled) setRelated(hits);
            })
            .catch(() => {
                // "More like this" is an accelerant, never a source of
                // user-visible error — the render guard below already
                // renders nothing for an empty list.
            });
        return () => {
            cancelled = true;
        };
    }, [job.id, job.company_domain, job.title, signedIn]);

    return (
        <div className={cn("relative overflow-hidden border border-border bg-card", className)}>
            {/* Identity header — title/company/location/freshness/fact-chips
                — rendered OUTSIDE the sign-in gate below (see `!signedIn`
                near the bottom of this component): a guest could previously
                never confirm which job they'd opened, since the blur+overlay
                covered the title along with everything else. Only the
                action row and body further down stay gated. */}
            <div className="border-b border-border px-5 pb-3.5 pt-1">
                <div className="flex items-start gap-3">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-semibold leading-tight tracking-tight">{decodeText(job.title)}</h2>
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
                                {chips.map((c) => {
                                    // Posted date is the EMPLOYER's claim (posting-freshness.ts)
                                    // — once classifyPostingFreshness has caught a relist (posted_at
                                    // re-stamped well after our own first_seen_at), this chip's claim
                                    // is exactly the one worth doubting, so it switches to the shared
                                    // caution status token instead of matching every other chip's
                                    // neutral styling (which would present it as equally trustworthy
                                    // as "first seen by us").
                                    const caution = c.kind === "posted" && freshness.kind === "relisted";
                                    return (
                                        <span
                                            key={c.kind}
                                            className={cn(
                                                "mono-data inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px]",
                                                caution ? STATUS_PILL.intv : "border border-border bg-background text-foreground",
                                            )}
                                        >
                                            <b className={cn("font-medium", !caution && "text-muted-foreground")}>
                                                {FACT_CHIP_KEY[c.kind]}
                                            </b>
                                            {/* "First seen by us…" — the one chip that underwrites a
                                                verified corpus fact, so it alone carries the signature
                                                underline (see globals.css's .verified-underline doc). */}
                                            <span className={c.kind === "first_seen" ? "verified-underline" : undefined}>
                                                {factValue(c.kind, c.label)}
                                            </span>
                                        </span>
                                    );
                                })}
                                {alsoIn && (
                                    <span className={cn(chipVariants({ active: true }), "mono-data h-auto py-1.5 text-[12px]")}>
                                        <b className="font-medium">also in</b>
                                        {alsoIn}
                                    </span>
                                )}
                                {/* G5d (Grok UX wave) — same quiet house tooltip
                                    mechanism (ContextHelp) as the row badge's,
                                    not a second ad-hoc one. Only worth
                                    explaining when BOTH dates show — a single
                                    date chip has nothing to disambiguate. */}
                                {chips.some((c) => c.kind === "posted") && chips.some((c) => c.kind === "first_seen") && (
                                    <ContextHelp
                                        content="Employer posted is the date on their listing. First seen by us is when our crawler actually found it — a relist can reset the employer's date without the role being new."
                                        className="self-center"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <CopyJobLinkButton jobId={job.id} />
                        {onClose && (
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={onClose}
                                className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-base text-muted-foreground hover:text-foreground"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Action row + body. Apply/Save render here for guests too
                (G4, Grok UX wave) — no longer blurred behind a paywall
                overlay, since clicking either already gates through
                `resolveApplyGateDecision` (jobs/page.tsx) rather than
                relying on this panel to physically block the click. */}
            <div>
            <div className="border-b border-border px-5 pb-3.5 pt-3.5">
                {/* Primary action row (docs-mockup.html Comp B2): Apply ink /
                    Save quiet — the two-weight subset of the button family
                    (THE RULES #3) that's left once "Am I a fit?" moved to
                    MCP (2026-08-02, see the McpHandoffNote in the "How you
                    match" rail below — the header row itself degrades by
                    omission rather than repeating that line up here). Prep
                    removed 2026-08-02 — see the static note below this row
                    instead of a button. */}
                <div className="flex flex-wrap items-center gap-2 px-5">
                    {job.apply_url && (
                        <Button onClick={onOpenPosting} className="gap-2">
                            <ArrowSquareOut size={16} />
                            {signedIn ? "Apply" : "Sign in to apply"}
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
                            Saved
                        </Link>
                    ) : (
                        <Button variant="quiet" onClick={onGoAfter} disabled={goingAfter} className="gap-2">
                            <Check size={16} />
                            {goingAfter ? "Saving…" : signedIn ? "Save" : "Sign in to save"}
                        </Button>
                    )}
                </div>
                {/* Prep runs in the user's AI (2026-08-02) — the ONE nudge
                    for this pane lives in the "How you match" rail below,
                    not duplicated up here (see that McpHandoffNote's
                    comment). "Apply with tailored resume" moved to MCP the
                    same day. "Mark as applied" was a third peer action here
                    (G2, Grok UX wave) — removed as a peer; it's reachable
                    via the apply-return prompt (jobs/page.tsx,
                    `shouldPromptApplyReturn`) after a real departure to the
                    employer's site, and via the Tracker's own status
                    controls (PursuitDetailSheet.tsx / yours/[id]/page.tsx),
                    never duplicated here as a third button. */}
            </div>

            <div className="px-5 pb-6 pt-4">
                {!signedIn ? (
                    <GuestDescriptionPreview description={job.description} onRequestSignIn={onRequestSignIn} />
                ) : (
                <>
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
                        {/* S4 exposure trust badges (dark launch) — positive-only,
                            same quiet mono/squared house style as the fact chips,
                            same ContextHelp tooltip mechanism as elsewhere in this
                            panel. Renders nothing until deriveExposureBadges has
                            something to say (see its doc comment). */}
                        {exposureBadges.length > 0 && (
                            <div className="mono-data mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                                {exposureBadges.map((b) => (
                                    <span
                                        key={b.label}
                                        className="inline-flex items-center border border-border px-2 py-1 font-medium text-muted-foreground"
                                    >
                                        {b.label}
                                        <ContextHelp
                                            content={`We check whether this posting appears in ${
                                                b.label === "Seen on Google" ? "Google's job search results" : "LinkedIn's job listings"
                                            } — ${b.checkedText.charAt(0).toLowerCase()}${b.checkedText.slice(1)}.`}
                                            className="self-center"
                                        />
                                    </span>
                                ))}
                            </div>
                        )}
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
                                    Use{" "}
                                    <span className="font-medium text-foreground">
                                        {signedIn ? "Apply" : "Sign in to apply"}
                                    </span>{" "}
                                    to read the full details on the employer&apos;s site.
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
                <McpHandoffNote
                    className="mb-5"
                    job={{
                        id: job.id,
                        title: decodeText(job.title),
                        company: cleanedCompany || job.company || "Unknown company",
                        location: locationText(job) || null,
                    }}
                />

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

                {/* A2 — "More like this" (Curiosity / Serial Positioning
                    Effect). Zero related → render nothing, no empty shell
                    (see the fetch effect above's error handling too). */}
                {related.length > 0 && (
                    <div className="mt-5">
                        <div className="mono-data mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            More like this
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {related.map((r) => (
                                <RelatedJobRow
                                    key={r.id}
                                    job={r}
                                    now={now}
                                    onClick={() => onOpenRelated?.(r.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}
                </>
                )}
            </div>
            </div>
        </div>
    );
}

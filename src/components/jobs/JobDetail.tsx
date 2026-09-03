"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ArrowSquareOut, BookmarkSimple, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { ContextHelp } from "@/components/ui/context-help";
import { ShareAction } from "@/components/ui/share-action";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { MatchChip } from "@/components/jobs/MatchChip";
import type { MatchScore } from "@/lib/match/score";
import { ReportJobButton } from "@/components/jobs/ReportJobButton";
import { ReportListingButton } from "@/components/jobs/ReportListingButton";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { assessedGhostSignals, buildFactChips, deriveExposureBadges, deriveGhostSignals, ghostCheckedText, alsoInLabel } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { jobCompanyHref } from "@/lib/companies/paths";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ghostMetaFor, decodeText, displayCompany, displayCompanyBrand, locationText, clampLocationSegments, shortDate, salaryText, postedAgeShort } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { presentJob } from "@/lib/presentation";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { STATUS_PILL, LISTING_STATE_CHIP, LISTING_STATE_CHIP_LABEL, LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { jobShareUrl } from "@/lib/jobs/share-url";
import { withShareRef } from "@/lib/share/share-decision";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { SHARE_JOB_TEXT } from "@/lib/seo/constants";
import { POSTING_AGE_CONTEXT_COPY, isAgeSignal, shouldShowAgeBalanceNote } from "@/lib/jobs/ghost-context-copy";
import { getRelatedJobsAction, getCompanyOpenCountAction } from "@/actions/jobs";
import { shouldSuppressOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { openCountText, buildCompanyJobsUrl } from "@/lib/companies/presentation";
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
export function JobDescription({ blocks }: { blocks: DescBlock[] }) {
    return (
        <div className="text-[14px] leading-relaxed sm:text-[13.5px] text-muted-foreground">
            {blocks.map((b, i) => {
                if (b.type === "heading") {
                    return (
                        <h4
                            key={i}
                            className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-[0.06em] text-foreground first:mt-0"
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
            className="sticky bottom-0 z-20 flex gap-2 border-t border-border bg-card/80 p-3.5 backdrop-blur-xl"
        >
            {job.apply_url && (
                <Button className="h-11 flex-1 gap-2 rounded-none bg-brand text-brand-foreground text-xs font-bold uppercase tracking-wider hover:bg-brand/90 transition-colors lg:h-10" onClick={onOpenPosting}>
                    <ArrowSquareOut size={18} weight="bold" />
                    {signedIn ? "Apply on Company Site →" : "Sign in to apply →"}
                </Button>
            )}
        </div>
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
 * `displayCompanyBrand`/`locationText`/`salaryText`/`postedAgeShort`
 * (lib/jobs/presentation.ts) — the exact same helpers `JobCard` itself
 * calls, so this row can never format a company name, salary, or age
 * differently than the SERP does.
 */
export function RelatedJobRow({ job, now, onClick }: { job: PublicJob; now: number; onClick: () => void }) {
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    const loc = locationText(job);
    return (
        <button
            type="button"
            data-testid="related-job-row"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            }}
            className="flex w-full flex-col gap-0.5 rounded-none border border-slate-300/80 bg-card px-3.5 py-2.5 text-left transition-all hover:border-brand hover:bg-chip/50 dark:border-slate-700 dark:bg-slate-900/60 cursor-pointer group"
        >
            <span className="truncate text-meta font-semibold text-foreground group-hover:text-brand transition-colors">{decodeText(job.title)}</span>
            <span className="mono-data truncate text-xs text-muted-foreground">
                {displayCompanyBrand(job.company, job.company_domain, job.title) || "Unknown company"}
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
    source,
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
    reportJobEnabled = false,
    collapseDescription = true,
    matchScore = null,
    matchAsOfDate = null,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    /** Where this panel was opened from — fires `job_viewed` once per job.id mount. */
    source: EventSource;
    onOpenPosting: () => void;
    /** When false, Apply/Save gate at click; description body stays public. */
    signedIn?: boolean;
    /** Opens auth for gated actions (e.g. "Report listing") — AuthPopover on
     *  the board, a `/login` redirect on `/jobs/[slug]`, not a second gate. */
    onRequestSignIn?: () => void;
    /** ITEM O-FE (2026-08-15) — probed once by the caller via
     *  `reportJobEnabledAction`; the flags endpoint isn't deployed yet, so
     *  this defaults to hidden rather than showing a button that 404s. */
    reportJobEnabled?: boolean;
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
    /** A2 — "More like this" row click. */
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
    /** Parent-is-the-scroller contract. When `false`, the mount site already
     *  owns `overflow-y-auto` (jobs/page.tsx mobile sheet's
     *  `mobile-detail-scroller`) — so JobDetail must not add a second scroll
     *  layer: no description clamp (see `collapsible` below) AND no pinned
     *  identity header (`sticky top-0` on title/chips/Apply/Save). When
     *  `true` (default), the xl+ pane uses a flex split — header stays
     *  outside the body scroller — instead of sticky inside one box.
     *  check — mount site is resolved by `resolveDetailMountSite` (state +
     *  breakpoint together); a `sm:`/`xl:` class here could silently disagree
     *  with it. */
    collapseDescription?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). Same value the SERP card and
     *  `sort=fit` read, computed once by the shared `PublicJobDetail` mount. */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`) — the receipt's "against your résumé of {date}" line. */
    matchAsOfDate?: string | null;
}) {
    const staleCheck = checkFreshness(job, now) === "stale";
    // Detail-module-only stand-in for `GHOST_META.unscored` (null there, so
    // list/company surfaces stay quiet on unscored rows): in THIS panel the
    // check ledger's facts are worth showing even before a scoring pass has
    // run — with a verdict pill that says exactly that, never a fabricated
    // clear (2026-08-14 investor-polish; founding rule: facts, no inference).
    const ghost = ghostMetaFor(job, now) ?? {
        label: "Not yet scored",
        cls: STATUS_PILL.saved,
        dot: "bg-st-saved",
        explain:
            "This posting hasn't been checked yet — the signals below are the facts we can already state.",
    };
    // S2 — HONESTY RULE: the row badge states a fact ("Fresh"/"Relisted");
    // this facts line is where the underlying dates it's based on live.
    const freshness = classifyPostingFreshness(job, now);
    const exceptionMark = rowExceptionMark(job, now);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), now) : null;
    const [descExpanded, setDescExpanded] = useState(false);
    useEffect(() => {
        setDescExpanded(false);
    }, [job.id]);
    useEffect(() => {
        captureEvent("job_viewed", { job_id: job.id, company_domain: job.company_domain, source });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.id, source]);
    // Identity-header location line — same progressive-disclosure idiom as
    // the description clamp above, for aggregator-feed `location` strings
    // that stuff many semicolon-joined locations into one field (see
    // clampLocationSegments's doc comment). Presentation-only: the
    // underlying `location` string is untouched.
    const [locationExpanded, setLocationExpanded] = useState(false);
    useEffect(() => {
        setLocationExpanded(false);
    }, [job.id]);
    const location = locationText(job);
    const locationDisclosure = useMemo(() => clampLocationSegments(location), [location]);
    const locationClamped = locationDisclosure.hidden.length > 0;
    // Presentation-module adoption (wave 3, ADOPTION.md): the single-location
    // display case below (`locationClamped` false — the common case) reads
    // through `presentJob` for postal/breadcrumb cleanup. The semicolon-split
    // clamp/disclosure above stays on the raw `location` string — it's
    // splitting DISTINCT locations an aggregator feed joined with ";",
    // orthogonal to (and upstream of) the single-location cleanup
    // `locationSummary` does, so cleaning before the split risks mangling a
    // semicolon-joined string that also happens to contain a dash.
    const locationDisplay = presentJob(job).location;
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    // `formatDescription(undefined)` and `formatDescription("")` both return
    // `[]` — collapsing "not yet hydrated" (list-scope stub, no `description`
    // key at all) into the same bucket as "hydrated, genuinely no
    // description." Only the field's presence distinguishes them.
    const hydrated = job.description !== undefined;
    // Long descriptions are clamped behind a "Show more" toggle so the sticky
    // detail panel doesn't run thousands of pixels tall. `collapseDescription`
    // (default true) is the seam that turns this off for mount sites that
    // already provide their own scroller — see its doc comment above.
    const collapsible = collapseDescription && (job.description?.length ?? 0) > 700;
    // Structured facts row (Deliverable 1, 2026-08-01) — consolidates what
    // used to be a separate "Posted X · First seen by us Y" prose line plus
    // this chip row into ONE scannable row; see buildFactChips for the
    // per-field include/omit decision (kept pure + unit-tested there).
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    // Pay now renders as its own header stat (Task 3, squared design-system
    // pass) rather than a chip among chips — filtered out here so it never
    // appears twice.
    const nonSalaryChips = chips.filter((c) => c.kind !== "salary");
    const salary = salaryText(job);
    // `cleanedCompany` keeps its legal suffix (e.g. "Qualys, Inc.") — it
    // feeds `jobCompanyHref` below, which uses it to build the `/companies/`
    // slug when the job has no `company_domain`, so it can't move to the
    // brand form without moving the slug too. `companyBrand` is the reader-
    // facing text (header, hiring-truth heading, MCP handoff copy) — same
    // split `displayCompanyBrand`'s own doc comment calls out.
    const cleanedCompany = displayCompany(job.company, job.company_domain);
    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);
    // Same helper /co's hero uses, but sourced from just this one posting —
    // the full-corpus call site (get-company.ts) has many more postings to
    // find repeated "about us" boilerplate across, so this returns null more
    // often. That's the honest outcome of a thinner corpus, not a bug.
    const aboutLine = useMemo(
        () => extractCompanyAboutLine([job], companyBrand || cleanedCompany || job.company || ""),
        [job, companyBrand, cleanedCompany],
    );
    // Himalayas-style flag chip (visual-identity pass) — see JobCard's
    // matching comment in app/page.tsx for the null-safety rationale.
    const countryFlag = countryToFlag(job.location_country);
    const alsoIn = alsoInLabel(job, variants);
    // EXPANDED ghost module (docs-mockup.html Comp B2) — honest, derived
    // signal list; see deriveGhostSignals's doc comment for why each line
    // reuses an existing single source instead of new inferred logic.
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, now);
    // Denominator is the ASSESSED signals, not every line rendered: an
    // untracked repost history and an undisclosed salary are absences of
    // data, and counting them as failed checks made ordinary postings read
    // "1/4 favorable" (live 2026-08-16). The unknowns are still shown — and
    // still counted, as unknowns — they just don't score against the job.
    const assessedSignals = assessedGhostSignals(ghostSignals);
    const favorableSignalCount = assessedSignals.filter((s) => s.status === "favorable").length;
    const unknownSignalCount = ghostSignals.length - assessedSignals.length;
    // Takes the job, not a timestamp: this line used to be handed
    // `job.updated_at` and so dated the verdict by the last SCRAPE, which is
    // what produced "checked 89d ago" over "first seen by us 89d ago".
    const checkedText = ghostCheckedText(job, now);
    // S4 — exposure trust badges (dark launch): [] for every job until
    // Subspace's upstream backfill lands (see deriveExposureBadges' doc).
    const exposureBadges = deriveExposureBadges(job, now);

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
        // Guests see this list gated behind sign-in — fetching for them would
        // spend up to three corpus queries per detail-open on rows nobody can
        // read. The open-count figure below is fetched separately and does
        // NOT share this gate — see that effect's own comment for why.
        if (!signedIn) return;
        getRelatedJobsAction(job.id, job.company_domain, job.title)
            .then((data) => {
                if (cancelled) return;
                setRelated(data.jobs);
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

    // ITEM N (2026-08-15), decoupled from sign-in 2026-08-20 — the
    // hiring-truth rail's "Live roles" figure used to read
    // `job.company_open_count`, a sync-time aggregate baked onto the job
    // document that structurally drifts from /co/[slug]'s own live count for
    // the same company (delta sync can't carry cross-table data). This used
    // to ride the `signedIn`-gated related-jobs fetch above, so guests —
    // almost certainly how a self-contradicting "0 live roles" card gets
    // seen — never got the live figure, only ever the stale one. `/co/[slug]`
    // already serves this same query to anonymous visitors with no gate at
    // all, and it's a single cheap query (unlike the 3-query related-jobs
    // list above), so it gets its own always-on fetch here instead. `null`
    // until this resolves or when the job has no `company_domain` — the
    // render below falls back to `job.company_open_count` in that window,
    // same as before this existed.
    const [liveOpenCount, setLiveOpenCount] = useState<OpenCount | null>(null);
    useEffect(() => {
        let cancelled = false;
        setLiveOpenCount(null);
        if (!job.company_domain) return;
        getCompanyOpenCountAction(job.company_domain)
            .then((count) => {
                if (!cancelled) setLiveOpenCount(count);
            })
            .catch(() => {
                // Presentation only — the render falls back to
                // `job.company_open_count`, same as before this existed.
            });
        return () => {
            cancelled = true;
        };
    }, [job.company_domain]);

    // Resolve to ONE open-count number the same way the render below reads
    // it (live figure first, stale field as fallback), then run it through
    // `shouldSuppressOpenCount` so a company whose live count is honestly 0
    // never renders "0 live roles" on a page that is itself one of that
    // company's live postings — see that function's doc comment for the
    // closed-job carve-out.
    const resolvedOpenCount =
        liveOpenCount != null ? liveOpenCount.value : typeof job.company_open_count === "number" ? job.company_open_count : null;
    const showOpenCount = resolvedOpenCount != null && !shouldSuppressOpenCount(resolvedOpenCount, job.vacancy_status === "closed");

    const hasCompanyIntel =
        showOpenCount ||
        (typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number");

    return (
        <div
            data-region="detail"
            className={cn(
                "relative rounded-none border border-border/80 bg-card/75 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
                collapseDescription && "flex min-h-0 flex-1 flex-col overflow-hidden",
                className,
            )}
        >
            {/* Identity block — pinned outside the scroll subtree when the pane
                owns scrolling (flex split); the mobile sheet keeps everything
                in one flow and passes collapseDescription={false}. */}
            <div
                className={cn(
                    "shrink-0 border-b border-border bg-card shadow-xs",
                )}
            >
                {/* Identity header */}
                <div className="px-4 pb-3.5 pt-4 sm:px-6 sm:pb-4">
                    <div className="flex items-start gap-3 sm:gap-3.5">
                        <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                        <div className="min-w-0 flex-1">
                            <h1 className="text-xl sm:text-[22px] font-bold leading-snug sm:leading-tight tracking-tight text-foreground">{decodeText(job.title)}</h1>
                            {matchScore && (
                                <div className="mt-1.5">
                                    <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
                                </div>
                            )}
                            <div className="mt-1 text-sm font-medium text-muted-foreground">
                                {cleanedCompany ? (
                                    <Link href={jobCompanyHref(cleanedCompany, job.company_domain)} className="font-semibold text-foreground hover:underline">
                                        {companyBrand}
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
                                {locationClamped ? (
                                    <>
                                        {(locationExpanded
                                            ? [...locationDisclosure.visible, ...locationDisclosure.hidden]
                                            : locationDisclosure.visible
                                        ).map((segment, i) => (
                                            <span key={i} className="block">
                                                {segment}
                                            </span>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setLocationExpanded((v) => !v)}
                                            className="mt-0.5 block text-xs font-medium text-brand hover:underline cursor-pointer"
                                        >
                                            {locationExpanded ? "Show less" : `+ ${locationDisclosure.hidden.length} more locations`}
                                        </button>
                                    </>
                                ) : (
                                    locationDisplay
                                )}
                            </div>
                            {exceptionMark && (
                                <div
                                    data-tour="row-exception"
                                    data-exception={exceptionMark.kind}
                                    className={cn(
                                        "mt-1.5 rounded-none border px-2.5 py-1 text-xs font-medium",
                                        exceptionMark.kind === "both"
                                            ? STATUS_PILL.closed
                                            : exceptionMark.kind === "relisted"
                                              ? LISTING_STATE_CHIP.relisted
                                              : exceptionMark.kind === "stale"
                                                ? STATUS_PILL.closed
                                                : "border-border/80 bg-background/50",
                                    )}
                                >
                                    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs font-semibold">
                                        <ContextHelp content={exceptionMark.explain} side="right">
                                            {exceptionMark.parts.map((part, i) => (
                                                <span key={part.text} className="inline-flex items-center">
                                                    {i > 0 && (
                                                        <span className="mx-1 text-muted-foreground/60" aria-hidden>
                                                            ·
                                                        </span>
                                                    )}
                                                    <span className={part.className}>{part.text}</span>
                                                </span>
                                            ))}
                                        </ContextHelp>
                                    </span>
                                    {(exceptionMark.kind === "relisted" || exceptionMark.kind === "both") &&
                                        freshness.postedMs != null &&
                                        firstSeenRelative && (
                                            <p className="mt-1 font-normal text-muted-foreground">
                                                Listed as new on {shortDate(freshness.postedMs)}, but this role first appeared{" "}
                                                {firstSeenRelative} — often a relist.
                                            </p>
                                        )}
                                </div>
                            )}

                            {/* Icon-fact grammar (board-redesign.html / serp-readout-redesign.html
                                §3: "`key value` chip becomes `icon value`... one icon set, used
                                everywhere" — supersedes the bordered key/value box this replaced).
                                No box/border: `FACT_CHIP_ICON` is the single icon-set chokepoint
                                shared with JobCard's row. Salary stays bold and first; a relisted
                                posted-date turns amber (the caution signal), same token used by
                                the meter pip and receipt row below. */}
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                {salary && (
                                    <span data-tour="jobs-pay" className="inline-flex items-center gap-1.5 text-xs">
                                        <FACT_CHIP_ICON.salary size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                                        <span className="mono-data font-semibold text-foreground">{salary}</span>
                                    </span>
                                )}
                                {nonSalaryChips.map((c) => {
                                    const caution = c.kind === "posted" && freshness.kind === "relisted";
                                    const FactIcon = FACT_CHIP_ICON[c.kind];
                                    return (
                                        <span
                                            key={c.kind}
                                            className={cn("inline-flex items-center gap-1.5 text-xs", caution && LISTING_STATE_TEXT.relisted)}
                                        >
                                            <FactIcon size={14} className={cn("shrink-0", !caution && "text-muted-foreground")} aria-hidden />
                                            <span className={cn("mono-data font-medium", !caution && "text-foreground")}>
                                                {c.label}
                                            </span>
                                        </span>
                                    );
                                })}
                                {alsoIn && (
                                    <span className="inline-flex items-center rounded-none border border-border/80 bg-background/50 text-xs overflow-hidden">
                                        <span className="bg-muted/70 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border/80">also in</span>
                                        <span className="px-2 py-0.5 font-medium text-foreground">{alsoIn}</span>
                                    </span>
                                )}
                                {typeof job.report_count === "number" && job.report_count > 0 && (
                                    <span className="inline-flex items-center rounded-none border border-amber-500/40 bg-amber-500/10 text-xs overflow-hidden">
                                        <span className="bg-amber-500/20 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-500 border-r border-amber-500/30">reported</span>
                                        <span className="px-2 py-0.5 font-medium text-foreground">
                                            {job.report_count} {job.report_count === 1 ? "user" : "users"}
                                        </span>
                                    </span>
                                )}
                                {nonSalaryChips.some((c) => c.kind === "posted") && nonSalaryChips.some((c) => c.kind === "first_seen") && (
                                    <ContextHelp
                                        content="Employer posted is the date on their listing. First seen by us is when our crawler actually found it — a relist can reset the employer's date without the role being new."
                                        className="self-center"
                                    />
                                )}
                            </div>

                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <ReportListingButton
                                job={job}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                            />
                            <ShareAction
                                title={`${job.title} at ${companyBrand}`}
                                text={SHARE_JOB_TEXT}
                                url={withShareRef(
                                    jobShareUrl(typeof window !== "undefined" ? window.location.origin : "", job),
                                    "job",
                                )}
                                jobId={job.id}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                            />
                            {onClose && (
                                <button
                                    type="button"
                                    aria-label="Close"
                                    onClick={onClose}
                                    className="flex h-10 w-10 items-center justify-center rounded-none glass-tint-muted text-base text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Action row */}
                <div className="border-t border-border/80 bg-card px-4 py-2.5 sm:px-6 sm:py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* House attention system (docs/design/ATTENTION.md,
                            channel 2): exactly one inverted-ink block per
                            view. Apply is the primary action this pane
                            exists for — same solid-foreground/background-text
                            treatment as the SERP's own Search button — not
                            the quietest element on the page. Save is the
                            secondary action: a plain 1px outline. */}
                        {job.apply_url && (
                            <Button onClick={onOpenPosting} className="gap-2 h-10 sm:h-9 px-5 rounded-none bg-brand text-brand-foreground hover:bg-brand/90 text-xs font-bold uppercase tracking-wider transition-colors">
                                <ArrowSquareOut size={16} />
                                {signedIn ? "Apply" : "Sign in to apply"}
                            </Button>
                        )}
                        {pursuit ? (
                            <Link
                                href={`/yours/${pursuit.id}`}
                                className="inline-flex h-10 sm:h-9 items-center gap-1.5 rounded-none glass-tint-emerald px-4 text-xs font-bold uppercase tracking-wider"
                            >
                                <Check size={16} weight="bold" />
                                Saved
                            </Link>
                        ) : (
                            <Button variant="outline" onClick={onGoAfter} disabled={goingAfter} className="gap-2 h-10 sm:h-9 px-4 rounded-none text-xs font-bold uppercase tracking-wider transition-colors">
                                <BookmarkSimple size={16} />
                                {goingAfter ? "Saving…" : "Save"}
                            </Button>
                        )}
                        {reportJobEnabled && job.apply_url && (
                            <ReportJobButton
                                jobUrl={job.apply_url}
                                jobTitle={job.title}
                                onRequireAuth={() => onRequestSignIn?.()}
                                className="ml-auto"
                            />
                        )}
                    </div>
                </div>
            </div>

            <div
                className={cn(
                    "px-4 pb-6 pt-4 sm:px-5",
                    collapseDescription && "min-h-0 flex-1 overflow-y-auto custom-scrollbar",
                )}
            >
                {/* Ghost check module: a tinted glass check ledger */}
                {ghost && (
                    <div data-tour="jobs-posting-check" className="mb-5 overflow-hidden rounded-none glass-panel p-4">
                        <div className="flex flex-col gap-2 border-b border-border/80 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                                <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                                    posting check
                                </span>
                                {ghostSignals.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span aria-hidden className="flex items-center gap-1">
                                            {ghostSignals.map((s, i) => (
                                                <i
                                                    key={i}
                                                    className={cn(
                                                        "h-2 w-3.5 rounded-full",
                                                        s.kind === "freshness" && freshness.kind === "relisted"
                                                            ? "bg-amber-500 shadow-2xs"
                                                            : s.status === "favorable"
                                                              ? "bg-emerald-500 shadow-2xs"
                                                              : s.status === "unfavorable"
                                                                ? "bg-slate-300 dark:bg-slate-600"
                                                                // Unknown reads as an outline, not a filled
                                                                // pip: nothing was measured, so there is no
                                                                // result to shade either way.
                                                                : "border border-dashed border-slate-300 dark:border-slate-700",
                                                    )}
                                                />
                                            ))}
                                        </span>
                                        {assessedSignals.length > 0 && (
                                            <span className="text-xs font-bold text-foreground">
                                                {favorableSignalCount}/{assessedSignals.length} favorable
                                            </span>
                                        )}
                                        {unknownSignalCount > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                · {unknownSignalCount} not tracked
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-2 sm:justify-end">
                                <span className={cn("inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider", ghost.cls)}>
                                    {ghost.label}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {checkedText.charAt(0).toLowerCase()}{checkedText.slice(1)}
                                </span>
                            </div>
                        </div>
                        {/* Explain copy only earns its place when the verdict isn't
                            already the unremarkable "clear and current" case — the
                            meter + pill above already say enough there. */}
                        {!(job.ghost_badge === "clear" && !staleCheck) && (
                            <div className="px-3.5 pt-2.5 text-xs text-muted-foreground">{ghost.explain}</div>
                        )}
                        {ghostSignals.length > 0 && (
                            <div className="mono-data grid grid-cols-1 gap-x-5 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2">
                                {ghostSignals.map((s) => {
                                    const relistCaution = s.kind === "freshness" && freshness.kind === "relisted";
                                    return (
                                    <div key={s.text} className="flex items-start gap-2">
                                        <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-bold text-xs", relistCaution ? LISTING_STATE_TEXT.relisted : s.status === "favorable" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                            {/* Three glyphs for three states. The meter above already
                                                excludes unknowns from the ratio and labels them
                                                "· N not tracked", but the ROW still marked them with the
                                                same "—" as a real negative — so a reader scanning the
                                                column tallied our missing data as findings against the
                                                employer, which is the misread the ratio fix was for. */}
                                            {relistCaution ? "!" : s.status === "favorable" ? "✓" : s.status === "unknown" ? "·" : "—"}
                                        </span>
                                        <div className="min-w-0 flex-1 leading-snug">
                                            <b className="text-xs font-bold uppercase tracking-wide text-foreground mr-1.5">{s.kind}</b>
                                            <span className={cn("text-xs", relistCaution ? LISTING_STATE_TEXT.relisted : "text-muted-foreground")}>
                                                {s.text}
                                                {!relistCaution && s.status === "unfavorable" && isAgeSignal(s) && shouldShowAgeBalanceNote(ghostSignals) && (
                                                    <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="ml-1 inline-block align-middle" />
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                        <div className="px-3.5 pb-3.5 pt-2.5">
                            {/* WHEN this verdict was last checked — a stated fact from
                                `updated_at`, not a fabricated checklist of what was
                                inspected (see ghostCheckedText's doc comment). */}
                            {/* Checked-time lives in the header row above — this
                                footer states only the provenance claim. */}
                            <div className="verified-underline mono-data inline-block text-xs font-medium text-muted-foreground">
                                every signal automated · nothing inferred
                            </div>
                            {/* S4 exposure trust badges (dark launch) — positive-only,
                                same quiet mono/squared house style as the fact chips,
                                same ContextHelp tooltip mechanism as elsewhere in this
                                panel. Renders nothing until deriveExposureBadges has
                                something to say (see its doc comment). */}
                            {exposureBadges.length > 0 && (
                                <div className="mono-data mt-2.5 flex flex-wrap items-center gap-2 text-xs">
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
                    </div>
                )}

                {/* The ghost-check ledger and description body render for
                    everyone — posting text is public; Apply stays gated. */}
                <div className="mb-5">
                    <div className="mb-2 text-[13px] font-semibold">About this role</div>
                    {blocks.length > 0 ? (
                        <>
                            <div
                                data-testid="job-detail-description"
                                className={cn("relative", collapsible && !descExpanded && "max-h-[20rem] overflow-hidden")}
                            >
                                <JobDescription blocks={blocks} />
                                {collapsible && !descExpanded && (
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                                )}
                            </div>
                            {collapsible && (
                                <button
                                    type="button"
                                    onClick={() => setDescExpanded((v) => !v)}
                                    className="mt-2 text-xs font-medium text-brand hover:underline cursor-pointer"
                                >
                                    {descExpanded ? "Show less" : "Show full description"}
                                </button>
                            )}
                        </>
                    ) : hydrated ? (
                        <div className="rounded-none border border-slate-300/80 bg-slate-50/70 p-4 text-[13.5px] text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 shadow-2xs">
                            No description was captured for this role.{" "}
                            {job.apply_url ? (
                                <>
                                    Use{" "}
                                    <span className="font-semibold text-foreground">
                                        {signedIn ? "Apply" : "Sign in to apply"}
                                    </span>{" "}
                                    to read the full details on the employer&apos;s site.
                                </>
                            ) : (
                                "Try the original posting for full details."
                            )}
                        </div>
                    ) : (
                        // Not hydrated yet (the SERP's list-scope stub has no
                        // `description` field, meilisearch.ts's
                        // JOB_LIST_ATTRIBUTES_TO_RETRIEVE) — distinct from a
                        // hydrated job that genuinely has no description
                        // (case above). Rendering the neutral empty-state box
                        // here would claim "nothing was captured" before the
                        // full doc even arrived. Same `.skeleton-bar` idiom
                        // as JobDetailSkeleton.
                        <div className="space-y-2.5" aria-hidden="true">
                            <div className="skeleton-bar h-3.5 w-full" />
                            <div className="skeleton-bar h-3.5 w-full" />
                            <div className="skeleton-bar h-3.5 w-5/6" />
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
                                    className="mono-data rounded-md border border-slate-300 bg-slate-100/90 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                >
                                    {decodeText(tag)}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Company hiring-truth mini-KPI rail */}
                {hasCompanyIntel && (
                    <div className="rounded-none border border-slate-300/90 bg-slate-50/80 p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/60 shadow-2xs">
                        <div className="mono-data text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                            {companyBrand || "This company"} · hiring truth
                        </div>
                        {/* Verbatim-or-absent (founding-wound law, about-line.ts) — a
                            single job's description is a much thinner corpus than
                            /co's full posting set, so this returns null far more
                            often here; that's the correct, honest behavior, not a
                            bug to work around. */}
                        {aboutLine && (
                            <p className="mt-2 text-[13px] leading-snug text-foreground/90">&ldquo;{aboutLine}&rdquo;</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-4 sm:gap-6">
                            {showOpenCount && (
                                <div className="min-w-[100px]">
                                    <div className="text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                                        {liveOpenCount != null
                                            ? openCountText({ openCount: liveOpenCount.value, openCountIsLowerBound: liveOpenCount.isLowerBound })
                                            : job.company_open_count!.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-0.5 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
                                        Live roles
                                    </div>
                                </div>
                            )}
                            {typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number" && (
                                <div className="min-w-[120px]">
                                    <div className="text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                                        {job.company_opened_90d.toLocaleString()}/{job.company_closed_90d.toLocaleString()}
                                    </div>
                                    <div className="mono-data mt-0.5 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
                                        Opened / closed, 90d
                                    </div>
                                </div>
                            )}
                        </div>
                        {cleanedCompany && (
                            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                                <Link
                                    href={
                                        job.company_domain?.trim()
                                            ? buildCompanyJobsUrl({ domain: job.company_domain.trim() })
                                            : jobCompanyHref(cleanedCompany, job.company_domain)
                                    }
                                    onClick={() => {
                                        if (onClose) onClose();
                                    }}
                                    className="text-[13px] font-medium text-foreground underline underline-offset-[3px] transition-opacity duration-100 hover:opacity-80"
                                >
                                    All jobs at {companyBrand || cleanedCompany}
                                </Link>
                                <Link
                                    href={jobCompanyHref(cleanedCompany, job.company_domain)}
                                    onClick={() => {
                                        if (onClose) onClose();
                                    }}
                                    className="text-[13px] font-medium text-foreground underline underline-offset-[3px] transition-opacity duration-100 hover:opacity-80"
                                >
                                    {companyBrand || cleanedCompany}
                                </Link>
                            </div>
                        )}
                    </div>
                )}

                {/* A2 — "More like this" (Curiosity / Serial Positioning
                    Effect). Zero related → render nothing, no empty shell
                    (see the fetch effect above's error handling too). */}
                {related.length > 0 && (
                    <div className="mt-5">
                        <div className="mono-data mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            More like this
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {related.map((r) => (
                                <RelatedJobRow
                                    key={r.id}
                                    job={r}
                                    now={now}
                                    onClick={() => onOpenRelated?.(r.id, r)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Footnote position (serp-readout-redesign.html annotation
                    9) — moved from between the description and the company
                    rail; "how you match" reads as an afterthought, not a
                    hiring-truth-rail peer. */}
                <McpHandoffNote
                    className="mt-5"
                    job={{
                        id: job.id,
                        title: decodeText(job.title),
                        company: companyBrand || job.company || "Unknown company",
                        location: locationText(job) || null,
                    }}
                />
            </div>
        </div>
    );
}

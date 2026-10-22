"use client";

/**
 * One result. Title + company/location on the left, a fixed-width data rail
 * (salary, ghost flag, age — top to bottom, whichever apply) on the right.
 * Two anchors, not a single stacked block: the left identity answers "what
 * is this, who's it at, where," the right rail answers "what's it worth,
 * anything to watch for, how stale" — different questions, so they read as
 * different columns rather than one run-on line.
 *
 * The title dominates for a ranking reason: `searchableAttributes` order puts
 * `title` first (JOBS_INDEX_SETTINGS, lib/jobs/meilisearch.ts), so the
 * engine's attribute rule ranks title matches above description matches —
 * making the title the loudest thing means the eye lands on the very text the
 * engine ranked. When visual hierarchy and ranking disagree, even correct
 * results feel arbitrary.
 *
 * `opened` (session-only, see `openedIds` in JobsContent) recesses a
 * previously-opened row's title to muted-medium instead of bold — a plain
 * "already read" signal, distinct from `active` (the row whose detail is
 * OPEN right now).
 *
 * Extracted out of jobs/page.tsx (2026-09-18, For-you B5 rebuild) so a
 * second surface — the For-you ranked-results list — can reuse the EXACT
 * same row instead of a parallel, divergent card shape. Search results in
 * page.tsx import it from here now; nothing about the row's behavior
 * changed in the move.
 */
import Link from "next/link";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ContextHelp } from "@/components/ui/context-help";
import { HiresInWord, hiresNoteOf } from "@/components/jobs/HiresIn";
import { MatchChip } from "@/components/jobs/MatchChip";
import { MetaLine } from "@/components/jobs/job-detail-primitives";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { DotSeparated } from "@/components/ui/dot-separated";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { LOCATION_UNKNOWN_TEXT, postedAgeShort } from "@/lib/jobs/presentation";
import { formatCardPlace, presentJob } from "@/lib/presentation";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { jobPath } from "@/lib/jobs/job-slug";
import { remoteScope, withRemoteScope } from "@/lib/jobs/remote-scope";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import type { Pursuit } from "@/lib/pursuits/types";
import { AppliedBadge } from "@/components/jobs/AppliedBadge";
import { cn } from "@/lib/utils";

export function JobCard({
    job,
    active,
    opened,
    onClick,
    onCompany,
    now,
    variantCount = 0,
    clusterLabel = "",
    expanded = false,
    onToggleExpand,
    dense = false,
    tourAnchor = false,
    matchScore = null,
    matchAsOfDate = null,
    reasonLine = null,
    pursuit,
    appliedPursuit,
    onGoAfter,
    saveSuccessPulse = false,
    position,
}: {
    job: PublicJob;
    active: boolean;
    opened: boolean;
    onClick: () => void;
    onCompany?: (job: PublicJob) => void;
    /** Accepted-but-unused: kept so call sites don't need editing. */
    onOpenPosting?: (job: PublicJob) => void;
    now: number;
    /** Accepted-but-unused: elite board styling removed from row chrome. */
    elite?: boolean;
    variantCount?: number;
    /** Collapsed-state pill text ("+N locations"/"+N openings"), computed
     *  by `clusterToggleLabel` (lib/jobs/cluster.ts) at the call site — the
     *  card just renders it, never derives it. */
    clusterLabel?: string;
    expanded?: boolean;
    onToggleExpand?: () => void;
    /** Accepted-but-unused: comfortable layout is the only SERP density now. */
    dense?: boolean;
    /** First visible result row — anchor for the jobs guided tour. */
    tourAnchor?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). */
    matchScore?: MatchScore | null;
    /** When true and `matchScore` is absent, render a locked fit teaser. */
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`) — the receipt's "against your résumé of {date}" line. */
    matchAsOfDate?: string | null;
    /** Why a recommended role is listed (`rowReasonLine`): two lines at most under the facts (the compact form), only on a résumé-ranked list. */
    reasonLine?: string | null;
    /** Existing pursuit for this job, if any — same contract JobDetail's
     *  bookmark reads. Optional (unlike JobDetail's required prop): the
     *  direct-construction unit test (jobs-card-posted-age.test.ts) renders
     *  `JobCard` without wiring pursuits, and the row's bookmark control
     *  simply doesn't render without a save handler rather than faking one. */
    pursuit?: Pursuit;
    /** A pursuit at Applied or later for this role or the same opening listed again
     *  (`trackedPursuitFor`) — shows the "Applied" badge. Separate from `pursuit`,
     *  which drives this row's own bookmark and must belong to this exact posting. */
    appliedPursuit?: Pursuit;
    onGoAfter?: () => void;
    saveSuccessPulse?: boolean;
    /** 1-based index of this row in the current search's rendered list
     *  (`hits`, jobs/page.tsx) — stamped as `data-position` for
     *  `useResultImpressions` to read off the DOM (SPEC §5's position-
     *  corrected-CTR requirement). Omitted when the card isn't rendered from
     *  a tracked search list, so no attribute is written and the row is
     *  simply not impression-tracked rather than tracked with a fake `0`. */
    position?: number;
}) {
    const presented = presentJob(job);
    const place = formatCardPlace(job);
    const accessibleName = `${presented.title} at ${presented.company.name}`;
    const exceptionMark = rowExceptionMark(job, now);
    const age = postedAgeShort(derivePostedTs(job), now);
    // `presented.location` (locationSummary(locationText(job))) passes the
    // `LOCATION_UNKNOWN_TEXT` sentinel through unchanged when nothing usable
    // came off the posting — that's an absence, not a value, so the fact
    // chip renders only when it's something OTHER than that (remote is
    // always a known value even when the underlying location is unknown,
    // since `locationText`'s remote branch never surfaces the sentinel).
    const locationKnown = job.work_type === "remote" || place !== LOCATION_UNKNOWN_TEXT;
    // Icon-fact grammar (board-redesign.html §rollout stage 1) — same
    // `buildFactChips` chokepoint JobDetail uses, so a card and the pane it
    // opens can never disagree about how a given fact's label reads. `null,
    // null` skips the posted/first_seen kinds (`age`, below, already covers
    // that on the row, in its own untouched format — folding buildFactChips'
    // `Posted ${age}` label in here would reintroduce the literal "Posted"
    // string jobs-card-posted-age.test.ts forbids). The rulebook's list-row
    // anatomy names exactly two facts for this line — pay, work mode — so
    // employment_type/experience_level (still shown in the detail pane) are
    // filtered out here rather than in the shared chokepoint. Work-type is
    // its own chip here, so location is deliberately plain (no
    // `locationWithMode` fold-in) — showing "Hybrid" in both the location
    // text AND its own chip would say the same fact twice.
    const factChips = buildFactChips(job, null, null).filter((c) => c.kind === "work_type" || c.kind === "salary");
    const freshness = classifyPostingFreshness(job, now);
    // "Hires in Canada" for a remote role whose posting says so in words its place fields lack (HiresIn.tsx).
    const hires = hiresNoteOf(matchScore);
    // A plain "Remote" reads "Remote (Canada)" when its posting limits it to a place its fields leave out (remote-scope.ts).
    const scope = remoteScope(job);
    // A4 (soft-surfaces): the row's only "active" signal is the ABSENCE of
    // an exceptionMark — "review"/"ghost"/"relisted" verdicts surface via
    // `exceptionMark` above (rowExceptionMark, the single chokepoint for
    // that enum); the "clear" (active) case renders no word at all, so
    // there is no separate `activelyPosted` state to source a second one
    // from here.

    return (
        <div
            // An article, not a listbox option: an option's children are
            // presentational, so the title link, company and Save inside it
            // were hidden from screen readers (axe nested-interactive, focus
            // group 2026-10-12). `aria-current` marks the open row instead.
            role="article"
            tabIndex={0}
            aria-current={active ? "true" : undefined}
            aria-label={`View ${accessibleName}`}
            data-job-row
            data-job-id={job.id}
            {...(position ? { "data-position": position } : {})}
            data-testid="job-row"
            {...(tourAnchor ? { "data-tour": "jobs-card" } : {})}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={cn(
                // rounded-none: KEEP — flush; rows are hairline-separated, not
                // bordered cards (rulebook item h): the divider lives on the
                // content wrapper below, inset past the tile, so this outer
                // grid carries no border or bottom margin of its own — rows
                // touch, the line between them starts at the title's x, not
                // the tile's.
                "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] rounded-none bg-transparent text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-live gap-x-3 px-[var(--list-inset)] pt-4",
                active && "bg-surface-hover border-l-2 border-l-brand",
            )}
        >
            <div className="self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-4">
            <div className="min-w-0">
                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                    <Link
                        href={jobPath(job)}
                        data-testid="job-title"
                        className={cn(
                            // Three lines below sm: on a 320px phone the title
                            // column is ~140px, and two lines cut "Registered
                            // Nurse, Pediatrics - Per Diem" to "Registered
                            // Nurse,…" (2026-10-02).
                            "text-base leading-snug line-clamp-2 max-sm:line-clamp-3",
                            // Selected row (`active`) freezes `:hover` in some
                            // browsers because the pointer never truly leaves —
                            // so the row that's already selected must not carry
                            // the hover-underline affordance at all; every other
                            // row still underlines on hover as usual.
                            !active && "hover:underline",
                            opened ? "text-muted-foreground" : "font-semibold text-foreground",
                        )}
                        onClick={(e) => {
                            // A real href is what makes the row crawlable and
                            // middle-click/copy-link-able. But a plain click must
                            // keep opening the in-page panel (no full navigation)
                            // — the row's own onClick already does that, so stop
                            // it from ALSO firing via bubbling (would double the
                            // telemetry + history push) and drive it from here
                            // instead. Modified clicks (new tab, etc.) and
                            // non-primary buttons are left alone to use the
                            // anchor's native behavior.
                            e.stopPropagation();
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            onClick();
                        }}
                    >
                        {presented.title}
                    </Link>
                    {/* Exception-only word marks beside the title (ATTENTION.md
                        channel 4) — `rowExceptionMark` is the single
                        chokepoint; default rows stay unmarked. */}
                    {exceptionMark && (
                        <span
                            data-testid="row-exception"
                            data-tour="row-exception"
                            data-exception={exceptionMark.kind}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex shrink-0 items-center whitespace-nowrap text-xs font-semibold leading-none"
                        >
                            <ContextHelp content={exceptionMark.explain} side="right">
                                {exceptionMark.parts.map((part, i) => (
                                    <span key={part.text} className="inline-flex items-center">
                                        {i > 0 && (
                                            <span className="mx-1 text-muted-foreground" aria-hidden>
                                                ·
                                            </span>
                                        )}
                                        <span className={part.className}>{part.text}</span>
                                    </span>
                                ))}
                            </ContextHelp>
                        </span>
                    )}
                </span>
                {/* Line2 (soft-surfaces ROWS spec): "{company} · {location}",
                    no pin icon — the identity line reads as plain text.
                    Inline text through `DotSeparated`, not flex items: the
                    "·" used to lead the location, so on a phone the location
                    wrapped to its own line starting with a stray dot, and as
                    a flex item a company name that wrapped left the dot
                    floating beside it (2026-10-02). */}
                <div
                    data-testid="job-row-meta"
                    title={[presented.company.name, locationKnown && withRemoteScope(place, scope)].filter(Boolean).join(" · ")}
                    className="mt-1 line-clamp-2 text-left text-sm text-muted-foreground"
                >
                    <DotSeparated
                        items={[
                            onCompany ? (
                                <>
                                    {/* Below lg the name is plain text, so a tap anywhere on
                                        the row opens the job: as a button it filled the
                                        middle of a phone row and a tap there opened the
                                        company page instead (2026-09-30). The job's detail
                                        links the company page from its header. */}
                                    <span className="lg:hidden">{presented.company.name}</span>
                                    <button
                                        type="button"
                                        data-testid="job-row-company"
                                        className="hidden text-left hover:text-foreground hover:underline lg:inline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCompany(job);
                                        }}
                                    >
                                        {presented.company.name}
                                    </button>
                                </>
                            ) : (
                                <span>{presented.company.name}</span>
                            ),
                            locationKnown && (
                                <span data-testid="job-location" title={scope ? `The posting says: “${scope.quote}”` : job.location ?? undefined}>
                                    {withRemoteScope(place, scope)}
                                </span>
                            ),
                        ]}
                    />
                </div>
                {/* Facts + status, one 14/20-scale secondary line joined by
                    the shared `MetaLine` "· " seam (JobDetail.tsx) — no
                    per-fact icons, no boxes/pills. Salary is the one bold
                    value (matches JobDetail's own facts row treatment);
                    status words carry their state in color alone, same as
                    the detail pane's verdict word — sharing this line with
                    the facts (instead of a second row) is what keeps the
                    comfortable row inside the rulebook's 96-112px band. */}
                {(factChips.length > 0 || freshness.kind === "fresh" || variantCount > 0 || hires) && (
                    <div className="mt-1 flex flex-wrap items-baseline text-sm text-muted-foreground">
                        <MetaLine
                            items={[
                                ...factChips.map((c) => (
                                    <span key={c.kind} className={cn(c.kind === "salary" && "font-semibold text-foreground")}>
                                        {c.label}
                                    </span>
                                )),
                                hires && <HiresInWord note={hires} />,
                                // "New" reads the SAME 7-day `classifyPostingFreshness`
                                // window everything else on the row already uses.
                                freshness.kind === "fresh" && (
                                    <span data-testid="freshness-badge" className="font-semibold text-muted-foreground">
                                        New
                                    </span>
                                ),
                                // "+N location(s)"/"+N opening(s)" joins the same
                                // flowing meta line as plain text (rulebook item k)
                                // instead of a boxed chip — still the cluster
                                // expand/collapse control, just unstyled as a button.
                                variantCount > 0 && (
                                    <button
                                        type="button"
                                        data-testid="cluster-toggle"
                                        className="hover:text-foreground hover:underline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onToggleExpand?.();
                                        }}
                                    >
                                        {expanded ? "hide" : clusterLabel}
                                    </button>
                                ),
                            ]}
                        />
                    </div>
                )}
                {reasonLine && (
                    <p data-testid="row-fit-reason" className="mt-1 text-left text-sm text-muted-foreground">
                        {reasonLine}
                    </p>
                )}
            </div>
            {/* Right meta column: bookmark (rulebook's icon-only row
                control) sits above match receipt and posted age so this
                column's height tracks the mid column's text instead of
                driving the row past the rulebook's 96-112px band. The
                bookmark is a real interactive control, not a decorative
                fact icon — exempted from the list region's svg count the
                same way ContextHelp's sr-only text and CompanyLogo already
                are. Report is a detail-only action (GROUP-C, standard one-
                entry-point-per-listing) — no row-level mount here. */}
            <span className="flex h-fit flex-col items-end gap-1 self-start">
                <span className="flex items-center gap-1">
                    {onGoAfter && (
                        // Saving is not opening: on mobile the row's panel is a sheet that would cover the save gate.
                        <span data-rulebook-exempt onClick={(e) => e.stopPropagation()}>
                            <RowBookmarkButton
                                pursuit={pursuit}
                                onGoAfter={onGoAfter}
                                successPulse={saveSuccessPulse}
                            />
                        </span>
                    )}
                </span>
                <AppliedBadge pursuit={appliedPursuit ?? pursuit} />
                {matchScore && <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />}
                {age && (
                    <span
                        data-testid="posted-age"
                        className={cn(
                            "mono-data text-xs leading-none",
                            "text-muted-foreground",
                        )}
                    >
                        {age}
                    </span>
                )}
            </span>
            </div>
        </div>
    );
}

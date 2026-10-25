/**
 * Small presentational pieces shared by list rows (JobCard, TodayHome), the
 * company page and the job detail views. Kept out of JobDetail.tsx so a list
 * row doesn't statically import the whole detail panel, which drags in the
 * résumé customize panel and its PDF export code: about 165 KB gzipped of
 * JavaScript a phone otherwise downloads and runs before the first row shows.
 * JobDetail.tsx re-exports these for its existing importers.
 */
import type { ReactNode } from "react";

/**
 * The single "· "-joining seam for every flowing facts/meta line in the jobs
 * surfaces (SERP row, SERP detail panel, /jobs/[slug] hero) — rulebook item a.
 * Each caller supplies its own ordered, already-filtered list of nodes (or
 * `false`/`null` for an absent fact); this component drops the absent ones
 * and attaches the "·" to the END of the item that precedes it, inside that
 * item's own span, so a wrapped line always starts with real
 * content — never an orphaned leading "·" (the bug this replaces: three
 * separate hand-written joins, one of which didn't separate at all, another
 * of which put the dot at the START of each item and let it wrap alone). */
export function MetaLine({ items }: { items: Array<ReactNode | null | false | undefined> }) {
    const visible = items.filter((n): n is ReactNode => n != null && n !== false);
    return (
        <>
            {visible.map((node, i) => (
                // Plain inline content, not `inline-flex`: as flex items the
                // node and its dot split, so an item that wrapped onto two
                // lines (a salary range on a 320px phone) left its dot
                // floating beside it (2026-10-02). Inside the caller's
                // flex-wrap row this span is the item; the dot stays glued
                // to the item's last word.
                <span key={i}>
                    {node}
                    {i < visible.length - 1 && (
                        // `mx-1`, not `ml-1`: the dot's own spacing must be
                        // symmetric and self-contained, not depend on the
                        // caller's flex container also carrying `gap-x-*`
                        // (the SERP row's container didn't, so with a
                        // one-sided `ml-1` its line rendered "Onsite
                        // ·Actively posted" — no space after the dot).
                        <span className="mx-1" aria-hidden>
                            ·
                        </span>
                    )}
                </span>
            ))}
        </>
    );
}

/**
 * One "value over label" KPI chip — the employer rail's "Live roles" shape,
 * pulled out so every KPI in the rail renders through the same primitive
 * instead of each stat hand-rolling its own value/label markup.
 */
export function KpiStat({ value, label, minWidthClassName = "min-w-[100px]" }: { value: string; label: string; minWidthClassName?: string }) {
    return (
        <div className={minWidthClassName}>
            <div className="text-xl font-semibold tabular-nums text-foreground dark:text-white">{value}</div>
            <div className="mono-data mt-0.5 text-sm text-muted-foreground">{label}</div>
        </div>
    );
}

/**
 * The "posting check" signals grid — the one seam shared by JobDetail.tsx's
 * SERP panel and JobDetailDocument.tsx's Receipt (both previously hand-wrote
 * an identical `grid-cols-1 ... sm:grid-cols-2` wrapper around their own
 * `signals.map(...)`, only the per-cell content differs between the two).
 * `sm:` is a VIEWPORT breakpoint, so on a desktop viewport it went 2-column
 * even when the caller's own rendered width was the narrow ~320px
 * `/jobs/[slug]` right rail — wrapping "Reposts ..." over four lines. A
 * `@container` query measures this wrapper's OWN width instead: the SERP
 * detail column (~800px) still gets 2 columns, the narrow rail collapses to
 * 1. (Container queries can't target the container element's own box, so
 * the containment and the queried grid have to be two nested elements.) */
export function PostingCheckSignalsGrid({ children }: { children: ReactNode }) {
    return (
        <div className="@container">
            <div className="mono-data grid grid-cols-1 gap-x-4 gap-y-2 pt-3 text-sm @min-[480px]:grid-cols-2">{children}</div>
        </div>
    );
}

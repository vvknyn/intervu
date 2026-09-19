import type { MatchComponent } from "@/lib/match/score";

/**
 * One row's worth of comparable text for the "Why this fits" card. A row
 * renders two columns ("Your résumé" | "This posting") ONLY when both
 * sides of the comparison are independently available; otherwise it falls
 * back to the single combined verdict every `MatchComponent` in this repo
 * actually carries (`detail` — see lib/match/score.ts, always one merged
 * string per factor, never split resume/posting fields). This keeps the
 * two-column layout structurally honest: it can only ever render when a
 * caller supplies real two-sided data, never a fabricated placeholder on
 * one side.
 */
export interface FitReasonSource {
    key: string;
    label: string;
    detail: string;
    resumeDetail?: string | null;
    postingDetail?: string | null;
}

export interface FitReasonRow {
    key: string;
    label: string;
    columns: "single" | "two";
    resumeText: string | null;
    postingText: string | null;
    singleText: string | null;
}

/**
 * Pure: turn match components into "Why this fits" rows. Two-column only
 * when a component supplies BOTH `resumeDetail` and `postingDetail`; every
 * other case (today, always — `scoreJobAgainstResume` never populates
 * either field) renders single-column from `detail`.
 */
export function buildFitReasonRows(components: FitReasonSource[]): FitReasonRow[] {
    return components.map((component) => {
        if (component.resumeDetail != null && component.postingDetail != null) {
            return {
                key: component.key,
                label: component.label,
                columns: "two",
                resumeText: component.resumeDetail,
                postingText: component.postingDetail,
                singleText: null,
            };
        }
        return {
            key: component.key,
            label: component.label,
            columns: "single",
            resumeText: null,
            postingText: null,
            singleText: component.detail,
        };
    });
}

/** Adapts a real `MatchScore`'s components (score.ts) — never split
 *  resume/posting fields today — to `FitReasonSource[]` for `buildFitReasonRows`. */
export function fitReasonSourcesFromComponents(components: MatchComponent[]): FitReasonSource[] {
    return components.map((c) => ({ key: c.key, label: c.label, detail: c.detail }));
}

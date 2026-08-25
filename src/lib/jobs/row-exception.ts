import { rowTrustChip } from "./badges";
import { classifyPostingFreshness } from "./posting-freshness";
import { GHOST_META } from "./presentation";
import { RELISTED_EXPLAIN } from "./relisted-explain";
import { LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import type { GhostChecked } from "./types";

export type RowExceptionKind = "both" | "stale" | "relisted" | "review";

export type RowExceptionPart = { text: string; className: string };

export type RowExceptionMark = {
    kind: RowExceptionKind;
    parts: RowExceptionPart[];
    explain: string;
};

/** Main jobs tour legend — one vocabulary for row marks and JIT coaches. */
export const EXCEPTION_KEY_TITLE = "Spot the exceptions";
export const EXCEPTION_KEY_BODY =
    "Violet Relisted means the employer's posted date was likely refreshed. Red Possibly stale means our signals suggest the posting may no longer be live. When both appear together, check before you apply.";

const STALE_CLASS = "text-st-closed";
const REVIEW_CLASS = "text-st-intv";
const RELISTED_CLASS = LISTING_STATE_TEXT.relisted;

const RELISTED_LABEL = "Relisted";

export type RowExceptionJob = GhostChecked & {
    posted_at?: string | null;
    first_seen_at?: string | null;
};

function stalePart(): RowExceptionPart {
    return { text: GHOST_META.likely_ghost!.label, className: STALE_CLASS };
}

function relistedPart(): RowExceptionPart {
    return { text: RELISTED_LABEL, className: RELISTED_CLASS };
}

function reviewPart(): RowExceptionPart {
    return { text: GHOST_META.caution!.label, className: REVIEW_CLASS };
}

/** SERP/detail exception mark — both > stale > relisted > review; clear stays unmarked. */
export function rowExceptionMark(job: RowExceptionJob, nowMs: number): RowExceptionMark | null {
    const trust = rowTrustChip(job, nowMs);
    const isStale = trust === "ghost" || job.ghost_badge === "likely_ghost";
    const isRelisted = classifyPostingFreshness(job, nowMs).kind === "relisted";
    const isReview = trust === "review";

    if (isStale && isRelisted) {
        return {
            kind: "both",
            parts: [relistedPart(), stalePart()],
            explain: `${RELISTED_EXPLAIN} ${GHOST_META.likely_ghost!.explain}`,
        };
    }
    if (isStale) {
        return {
            kind: "stale",
            parts: [stalePart()],
            explain: GHOST_META.likely_ghost!.explain,
        };
    }
    if (isRelisted) {
        return {
            kind: "relisted",
            parts: [relistedPart()],
            explain: RELISTED_EXPLAIN,
        };
    }
    if (isReview) {
        return {
            kind: "review",
            parts: [reviewPart()],
            explain: GHOST_META.caution!.explain,
        };
    }
    return null;
}

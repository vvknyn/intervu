import { STATUS_PILL } from "@/lib/ui/status-tokens";
import type { GhostBadge, PublicJob } from "@/lib/jobs/types";

/**
 * Pure presentation helpers for a job posting — the vocabulary the ledger row
 * and the detail panel BOTH speak.
 *
 * These lived in app/page.tsx while `/` was the only surface rendering a job.
 * `JobDetail` now also opens from a pursuit (/yours/[id]), so they moved here
 * rather than being duplicated: two copies of "how do we clean a company name"
 * is exactly how one surface starts disagreeing with another about the same
 * posting. Everything here is pure — no clock reads, no I/O — so callers thread
 * their own `now` and these stay usable from a render body.
 */

// Ghost-badge presentation. Colors route through the shared status-token
// chokepoint (lib/ui/status-tokens.ts): caution/likely_ghost → intv (amber),
// clear → offer (green). Token classes carry both light + dark values, so the
// per-state dark: overrides are no longer needed.
export const GHOST_META: Record<GhostBadge, { label: string; cls: string; dot: string; explain: string } | null> = {
    likely_ghost: {
        label: "Possible ghost job",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv",
        explain:
            "Subspace's signals flag this posting as a possible ghost job — it may be stale, evergreen, or not actively hiring. Worth verifying before you invest time.",
    },
    caution: {
        label: "Worth verifying",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv/80",
        explain: "Some signals suggest this posting is worth a quick sanity-check before you apply.",
    },
    clear: {
        label: "No ghost signals",
        cls: STATUS_PILL.offer,
        dot: "bg-st-offer",
        explain: "No ghost-risk signals — this posting looks active.",
    },
    unscored: null,
};

/**
 * Neutral "hasn't been re-checked" stand-in for `GHOST_META.clear` (Phase
 * 1-a #5) — same shape, used instead of it whenever `checkFreshness` says
 * the check backing a "clear" verdict is stale. Keeps the positive, green
 * "no ghost signals" claim from surviving past the point the data behind it
 * stopped being current (the observed bug: a green badge on a 99-112-day-old
 * check sitting next to a dead apply link).
 */
export const STALE_CLEAR_META: NonNullable<(typeof GHOST_META)["clear"]> = {
    label: "Not recently verified",
    cls: STATUS_PILL.intv,
    dot: "bg-st-intv/60",
    explain: "This posting hasn't been re-checked recently — we can't confirm it's still active. Worth a quick sanity-check before you apply.",
};

/**
 * Single chokepoint for which `GHOST_META` entry a job's row badge AND
 * detail-panel banner render from — so the two surfaces can never disagree
 * about whether a "clear" verdict is still current.
 */
export function ghostMetaFor(ghostBadge: GhostBadge, stale: boolean) {
    return ghostBadge === "clear" && stale ? STALE_CLEAR_META : GHOST_META[ghostBadge];
}

export function prettyEnum(s: string | null | undefined): string {
    if (!s || s === "unknown") return "";
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Decode URL-encoded source data (e.g. "Wisdom%20AI" → "Wisdom AI") safely. */
export function decodeText(s: string | null | undefined): string {
    if (!s) return "";
    if (!s.includes("%")) return s;
    try {
        return decodeURIComponent(s);
    } catch {
        return s.replace(/%20/g, " ");
    }
}

/** Company names sometimes carry a leading req/location code (e.g. "USA102 Acme Inc"). Strip it. */
export function cleanCompany(s: string | null | undefined): string {
    return decodeText(s).replace(/^[A-Z]{2,5}\d{2,6}\s+/, "").trim();
}

export function locationText(j: PublicJob): string {
    if (j.location) return decodeText(j.location);
    const parts = [j.location_city, j.location_state, j.location_country].map(decodeText).filter(Boolean);
    if (parts.length) return parts.join(", ");
    if (j.work_type === "remote") return "Remote";
    return "Location not listed";
}

const SALARY_PERIOD: Record<string, string> = {
    yearly: "yr", year: "yr", annual: "yr", annually: "yr",
    hourly: "hr", hour: "hr", monthly: "mo", month: "mo", weekly: "wk", daily: "day",
};

export function salaryText(j: PublicJob): string | null {
    if (j.salary_min == null && j.salary_max == null) return null;
    const cur = j.salary_currency ? `${j.salary_currency} ` : "";
    const period = j.salary_period ? SALARY_PERIOD[j.salary_period.toLowerCase()] ?? j.salary_period : "";
    const per = period ? `/${period}` : "";
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
    if (j.salary_min != null && j.salary_max != null) {
        return `${cur}${fmt(j.salary_min)}–${fmt(j.salary_max)}${per}`;
    }
    const one = (j.salary_min ?? j.salary_max) as number;
    return `${cur}${fmt(one)}${per}`;
}

/** Compact "Jul 23"-style date for JobDetail's relisted disclosure sentence —
 *  the one place S2 names a calendar date rather than a relative age. */
export function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

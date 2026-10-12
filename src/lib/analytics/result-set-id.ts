import { randomUuidFallback } from "@/lib/telemetry/client";

/**
 * The id analytics give one rendered result set (`query_id` on
 * `results_impressed`, `result_clicked`, `apply_clicked`), so impressions
 * and the clicks they produce still join for a click-through rate.
 *
 * Never the search's own `searchId`. That id keys the anonymous search log
 * (lib/jobs/search-log.ts), which holds the words searched, and PostHog and
 * the behavioural ledger tie events to a signed-in account: sharing the id
 * would let an account be joined to what it searched. This one is minted in
 * the browser, once per `searchId` (so load-more pages keep it), and goes
 * nowhere but analytics.
 */
const minted = new Map<string, string>();

/** Result sets remembered; older ones only matter to a list no longer on screen. */
const REMEMBERED = 50;

function newId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : randomUuidFallback();
}

export function resultSetAnalyticsId(searchId: string | null | undefined, mint: () => string = newId): string {
    if (!searchId) return "";
    let id = minted.get(searchId);
    if (!id) {
        id = mint();
        minted.set(searchId, id);
        if (minted.size > REMEMBERED) minted.delete(minted.keys().next().value as string);
    }
    return id;
}

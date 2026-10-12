"use server";

import { isCurrentUserAdmin } from "@/actions/admin";
import { collectMetrics, type MetricsReport } from "@/lib/admin/metrics";
import { collectSearchDemand } from "@/lib/admin/search-demand-collect";
import type { SearchDemand } from "@/lib/admin/search-demand";

/**
 * The only door between the metrics collector (server-only, firebase-admin)
 * and the client component that renders it.
 *
 * Gated on the SAME `isCurrentUserAdmin` the rest of /admin uses rather than a
 * second notion of "admin" — these numbers cover the whole user base, so the
 * gate has to be the one that is already audited, not a parallel copy of it.
 */
export async function fetchAdminMetrics(): Promise<{ report: MetricsReport } | { error: string }> {
    if (!(await isCurrentUserAdmin())) return { error: "Forbidden" };
    try {
        return { report: await collectMetrics() };
    } catch (error) {
        // A whole-collector failure (bad credentials, project unreachable) is
        // distinct from a single metric failing, which the collector already
        // isolates into that metric's own `error`.
        console.error("[admin-metrics] collection failed:", error);
        return { error: error instanceof Error ? error.message : "Failed to read metrics." };
    }
}

/** The admin "Search demand" lists (lib/admin/search-demand.ts), behind the same gate. */
export async function fetchSearchDemand(): Promise<{ demand: SearchDemand } | { error: string }> {
    if (!(await isCurrentUserAdmin())) return { error: "Forbidden" };
    try {
        return { demand: await collectSearchDemand() };
    } catch (error) {
        console.error("[admin-metrics] search demand failed:", error);
        return { error: error instanceof Error ? error.message : "Failed to read search demand." };
    }
}

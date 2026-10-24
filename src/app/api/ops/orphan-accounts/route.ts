/**
 * POST /api/ops/orphan-accounts — the daily orphan-account report
 * (lib/account/orphan-accounts.ts), called by the host cron
 * (deploy/run-orphan-accounts.sh). Guard: `ORPHAN_ACCOUNTS_CRON_SECRET` as a
 * bearer, compared in constant time; unset means always 503.
 *
 * Report only: it deletes nothing and answers counts. A failed WorkOS or
 * store read answers 500, never zero.
 */
import { NextResponse } from "next/server";

import { getAgentStore } from "@/lib/agent/store";
import { getWorkosUserManagement } from "@/lib/auth/workos-runtime";
import { realOrphanSources, scanOrphans, type OrphanReport } from "@/lib/account/orphan-accounts";
import { bearerMatches } from "@/lib/retention/bearer";

export const dynamic = "force-dynamic";

/** 200 with the counts, or 500 when the scan could not finish. */
export async function orphanScanResponse(scan: () => Promise<OrphanReport>): Promise<NextResponse> {
    try {
        return NextResponse.json(await scan(), { status: 200 });
    } catch (error) {
        console.error(`[orphan-accounts] scan failed: ${error instanceof Error ? error.message : "unknown"}`);
        return NextResponse.json({ error: "scan failed" }, { status: 500 });
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    const secret = process.env.ORPHAN_ACCOUNTS_CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
    if (!bearerMatches(request.headers.get("authorization"), secret)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const store = getAgentStore();
    return orphanScanResponse(async () => scanOrphans(realOrphanSources(await getWorkosUserManagement(), store), store));
}

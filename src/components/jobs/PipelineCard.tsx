"use client";

import Link from "next/link";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { boardColumn, orderPursuits, type Pursuit } from "@/lib/pursuits/types";
import { TRACKER_BOARD_COLUMNS } from "@/lib/pursuits/tracker-display";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyName } from "@/lib/jobs/presentation";

/** Same stage buckets/labels as the /yours board — sourced directly from
 *  `TRACKER_BOARD_COLUMNS` (the one place lane label/order lives) rather
 *  than a hand-typed parallel list, so this card's tiles can't drift from
 *  the board's own lane heads (it previously said "Interview" here and
 *  "Interviewing" there). Just a subset: no "closed" tile. */
const STAGE_TILES = TRACKER_BOARD_COLUMNS.filter(({ column }) => column !== "closed");

function pursuitTitle(p: Pursuit): string {
    return p.job_snapshot?.title ?? p.position;
}
// `job_snapshot.company`/`company_name` are Firestore-stored raw values (same
// snapshot shape /yours and /yours/history read) — the live Meili index
// carries the ATS-stated raw name permanently (intervu owns brand cleaning
// at display time, never at ingest), so this rail widget needs the same
// render-time clean those two pages already apply.
function pursuitCompany(p: Pursuit): string {
    return displayCompanyName(p.job_snapshot?.company ?? p.company_name);
}

/**
 * Real, timestamp-derived status line for one pipeline row. Deliberately
 * carries no "listing went inactive" / "role still live" claim (the mock's
 * fake copy) — no such detection exists (spec: "no invented data").
 */
function statusLine(p: Pursuit, nowMs: number): string {
    switch (p.status) {
        case "interested":
            return `saved ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "resume_ready":
            return `resume ready ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "applied":
            return `applied ${formatRelativeAge(p.applied_at ?? p.updated_at, nowMs)}`;
        case "interviewing":
            return p.interview_date
                ? `interview ${formatRelativeAge(p.interview_date, nowMs)}`
                : `interviewing · updated ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "offer":
            return `offer ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "rejected":
        case "withdrawn":
            return `closed ${formatRelativeAge(p.updated_at, nowMs)}`;
    }
}

/**
 * Rail "Pipeline" section (editorial pass: a ruled section, not a card).
 * Reads `usePursuits()` directly — the same shared, guest-aware hook the
 * page and TopBar already use — rather than taking pursuits as a prop, so
 * this needs no wiring beyond `nowMs` and renders identically for
 * signed-in and guest visitors.
 */
export function PipelineCard({ nowMs }: { nowMs: number }) {
    const { pursuits } = usePursuits();
    const ordered = orderPursuits(pursuits).slice(0, 3);
    // One mono sentence with linked counts (spec: "0 saved · 0 applied · …"),
    // not stat tiles — the STAGE_TILES vocabulary stays the single source of
    // truth for which stages/labels exist, just rendered as inline text.
    const counts = STAGE_TILES.map((tile) => ({
        ...tile,
        count: pursuits.filter((p) => boardColumn(p) === tile.column).length,
    }));

    return (
        <div className="border-t border-foreground pt-2.5">
            <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Pipeline</span>
                <Link href="/yours" className="text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground">
                    open tracker →
                </Link>
            </div>
            <p className="text-xs text-foreground">
                {counts.map((tile, i) => (
                    <span key={tile.label}>
                        {i > 0 && " · "}
                        {tile.count} {tile.label.toLowerCase()}
                    </span>
                ))}
            </p>
            {ordered.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2.5">
                    {ordered.map((p) => (
                        <Link key={p.id} href={`/yours/${p.id}`} className="block transition-colors duration-100 hover:text-foreground">
                            <div className="truncate text-xs">
                                {pursuitTitle(p)} · {pursuitCompany(p)}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {statusLine(p, nowMs)}
                            </div>
                        </Link>
                    ))}
                </div>
            ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                    Nothing saved. Save a role from the ledger and it appears here.
                </p>
            )}
        </div>
    );
}

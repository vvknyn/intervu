/**
 * POST /api/telemetry — thin I/O half. Decision-making lives in
 * `lib/telemetry/ingest.ts` (shape/size/name/clock/dedup) and
 * `lib/telemetry/rate-limit.ts` (per-session AND per-IP budgets); this file
 * only reads guards and identity off the Request, calls those, and inserts.
 *
 * SPEC.md is not in this repo — see docs/telemetry/SPEC-PROVENANCE.md.
 *
 * Guard order follows SPEC §4 exactly:
 *   1. Content-Length, BEFORE request.json() — the container is a single
 *      `mem_limit: 1g` process (docker-compose.yml:22), so parsing an
 *      unbounded body first defeats the whole point of the cap.
 *   2. batch length > 50 -> 400
 *   3–5. per-event props/name/clock guards (ingest.processBatch)
 *   6. bot UA -> drop silently
 *   7. per-session AND per-IP rate limits (rate-limit.partitionByRateLimit)
 *   8. insert, ON CONFLICT DO NOTHING (no inference target — see
 *      `insertRows` for why), one multi-row statement, rows pre-sorted by
 *      event_id (unsorted multi-row upserts caused 7,318 deadlocks in this
 *      codebase's history)
 *   9. the success path always answers 204 — guards 1-2 above can still
 *      answer 413/400, but NO response ever carries a body (every return
 *      is `new NextResponse(null, ...)`) and no per-event outcome is ever
 *      surfaced to the caller
 *  10. never throw into the request path
 *
 * Identity: `user_id` is never read off the request body (see
 * `RawTelemetryEvent` in lib/telemetry/types.ts) — it is resolved exactly
 * once per request via `getServerUser()`, the one place in this app that
 * answers "who is signed in", and stamped onto every admitted row.
 * `/api/telemetry` is covered by the AuthKit middleware (`src/middleware.ts`
 * matcher excludes only static assets), so `withAuth()` resolves here.
 */
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getTelemetryPg, type Queryable } from "@/lib/pg/pool";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";
import { isBatchTooLarge, isBotUserAgent, MAX_BODY_BYTES, processBatch, sortByEventId } from "@/lib/telemetry/ingest";
import { partitionByRateLimit } from "@/lib/telemetry/rate-limit";
import type { TelemetryBatchRequest, TelemetryRow } from "@/lib/telemetry/types";

/** The complete insert column list: 12 columns — the 5 `LEDGER_COLUMN_RULES`
 *  columns (query_id, source, job_id, company_domain, position) plus the 7
 *  envelope/identity columns (event_id, occurred_at, session_id, visitor_id,
 *  user_id, event_name, props). It is NOT an enumeration of the ledger
 *  columns alone.
 *
 *  Exported so a conformance test (`tests/unit/telemetry-column-conformance.test.ts`)
 *  can assert every `LEDGER_COLUMN_RULES` key is admitted here. The ledger
 *  columns are hand-enumerated in three places — this array, `ingest.ts`'s
 *  guard chain, and its row builder — so a rule added to `LEDGER_COLUMN_RULES`
 *  but never added to this list is the gap that would hide silently: the
 *  column would validate and then never be written. */
export const TELEMETRY_COLUMNS = [
  "event_id",
  "occurred_at",
  "session_id",
  "visitor_id",
  "user_id",
  "event_name",
  "source",
  "query_id",
  "job_id",
  "company_domain",
  "position",
  "props",
] as const;

/**
 * Single greppable marker for "admitted telemetry events never reached the
 * ledger" — the one server-side signal for a client contract that always
 * answers 204 regardless of outcome (SPEC §4 guard 9). Both ways this
 * happens — no pool configured at all, or a connected pool whose insert
 * throws (e.g. a Postgres connection FATAL from a missing pg_hba rule) —
 * share this one string so an operator (or a health check) has exactly one
 * thing to grep for, not two ad hoc log messages that happen to mean the
 * same thing.
 *
 * `intervu.job_heartbeats` (the repo's existing job-liveness mechanism,
 * `writeHeartbeat` in `lib/telemetry/heartbeat.ts`) is deliberately NOT used
 * here: the `telemetry_pg` role this route's pool authenticates as has only
 * `usage` on the schema and `insert` on `telemetry_events` itself
 * (`deploy/db-box/telemetry-schema.sql` grants, no grant on
 * `job_heartbeats`), so a heartbeat upsert would fail with permission
 * denied — and widening that grant would hand the internet-facing ingest
 * credential write access outside its one table, the exact escalation the
 * narrow role was designed to prevent.
 */
export const TELEMETRY_INGEST_DROPPED_MARKER = "TELEMETRY_INGEST_DROPPED";

/**
 * Records one drop and reports whether THIS call should also emit the
 * once-per-process stdout line — two different concerns sharing one call
 * site because they're driven by the same event, kept as separate state so
 * neither corrupts the other:
 *
 *  - `droppedIngestCount`/`lastDroppedIngestAt` (read via
 *    `getTelemetryIngestDropStats`) ALWAYS advance, on every single drop —
 *    this is the countable, live signal a caller can poll to answer "how
 *    many, and is it still happening now."
 *  - the boolean return value is throttled to true exactly once per
 *    process (`ingestDropLogged`) — without that gate, a sustained
 *    misconfiguration (TELEMETRY_PG_URL unset, or a persistent connection
 *    FATAL) would write a stdout line on every request forever, becoming
 *    its own outage on a busy endpoint. The stats above are what tell a
 *    caller dropping is CONTINUING after that one line stops repeating.
 *
 * Exported (with the test-only reset below) so both are unit-testable
 * without mocking `getTelemetryPg`, `getServerUser`, or a Next `Request`.
 */
let droppedIngestCount = 0;
let lastDroppedIngestAt: string | null = null;
let ingestDropLogged = false;
export function recordDroppedIngest(admittedCount: number): boolean {
  if (admittedCount === 0) return false;
  droppedIngestCount += admittedCount;
  lastDroppedIngestAt = new Date().toISOString();
  if (ingestDropLogged) return false;
  ingestDropLogged = true;
  return true;
}

/**
 * Machine-readable, LIVE status for whether admitted events are currently
 * reaching the ledger — see `GET` below for the HTTP surface. Deliberately
 * NOT a database read: `telemetry_pg` (this route's own credential) can
 * only INSERT into `telemetry_events` (`deploy/db-box/telemetry-schema.sql`
 * §4), so a status check that depended on that same connection would go
 * blind at the one moment it matters most — when the connection itself is
 * the thing that's broken. In-process state is sufficient for this
 * deployment: the container is a single `mem_limit: 1g` Node process (see
 * `MAX_BODY_BYTES` above), not a multi-worker cluster, so one counter is
 * authoritative for everything this process serves.
 */
export function getTelemetryIngestDropStats(): { droppedCount: number; lastDroppedAt: string | null } {
  return { droppedCount: droppedIngestCount, lastDroppedAt: lastDroppedIngestAt };
}

/** Test-only reset — mirrors `clearTelemetryRateLimitStateForTests`. */
export function resetDroppedIngestLogForTests(): void {
  droppedIngestCount = 0;
  lastDroppedIngestAt = null;
  ingestDropLogged = false;
}

/** The only I/O beyond the request itself. One multi-row INSERT, never a
 *  loop of single-row inserts — `ON CONFLICT DO NOTHING` makes a retried or
 *  double-fired beacon free. */
async function insertRows(pg: Queryable, rows: readonly TelemetryRow[]): Promise<void> {
  // `processBatch` hands back rows sorted by event_id, but
  // `partitionByRateLimit` re-groups by session_id first — re-sort here so
  // the property this insert actually depends on (a consistently ordered
  // multi-row upsert; unsorted ones caused 7,318 deadlocks in this
  // codebase's history) holds regardless of what happens upstream.
  const sorted = sortByEventId(rows);
  const values: unknown[] = [];
  const tuples = sorted.map((row, i) => {
    const base = i * TELEMETRY_COLUMNS.length;
    values.push(
      row.event_id,
      row.occurred_at,
      row.session_id,
      row.visitor_id,
      row.user_id,
      row.event_name,
      row.source,
      row.query_id,
      row.job_id,
      row.company_domain,
      row.position,
      JSON.stringify(row.props),
    );
    return `(${TELEMETRY_COLUMNS.map((_, j) => `$${base + j + 1}`).join(", ")})`;
  });

  await pg.query(
    // No inference target on ON CONFLICT: Postgres requires SELECT on any
    // column named there, and `telemetry_pg` is insert-only by design (no
    // SELECT grant — deploy/db-box/telemetry-schema.sql). The table's only
    // unique constraints are PRIMARY KEY (id) (server-generated) and
    // UNIQUE (event_id), so a bare `do nothing` can only ever resolve an
    // event_id duplicate in practice. Kept identical, on purpose, to the
    // probe in deploy/db-box/verify-telemetry-grants.sh so that script can
    // never pass while this statement is the one actually denied.
    `insert into intervu.telemetry_events (${TELEMETRY_COLUMNS.join(", ")})
     values ${tuples.join(", ")}
     on conflict do nothing`,
    values,
  );
}

/**
 * Guard 8's decide-and-log wiring, pulled out of `POST` so it is directly
 * testable with a fake `Queryable` instead of mocking `getTelemetryPg`,
 * `getServerUser`, or a Next `Request`. Never throws — whichever branch
 * fails to persist `admitted` records the drop (see `recordDroppedIngest`)
 * and returns; the caller always proceeds to the 204 response either way.
 */
export async function writeAdmittedRows(pg: Queryable | null, admitted: readonly TelemetryRow[]): Promise<void> {
  if (pg && admitted.length > 0) {
    try {
      await insertRows(pg, admitted);
    } catch (err) {
      if (recordDroppedIngest(admitted.length)) {
        console.error(`[telemetry] ${TELEMETRY_INGEST_DROPPED_MARKER}: insert failed`, err);
      }
    }
  } else if (recordDroppedIngest(admitted.length)) {
    console.error(
      `[telemetry] ${TELEMETRY_INGEST_DROPPED_MARKER}: no pg pool configured (TELEMETRY_PG_URL unset?) — ` +
        "admitted events are being dropped silently; logging this once per process, not per request",
    );
  }
}

/**
 * GET /api/telemetry — status only, no client contract to preserve (unlike
 * POST, nothing depends on this always answering the same way). Exists so
 * an external check can poll `droppedCount`/`lastDroppedAt` live, since
 * neither can be read any other way: they live in this process's memory,
 * not a database (see `getTelemetryIngestDropStats`'s doc for why), and the
 * once-per-process stdout line in `writeAdmittedRows` only ever fires once
 * per outage, so it cannot answer "is this still happening" on its own.
 * `poolConfigured` distinguishes the two root causes this route can hit
 * (TELEMETRY_PG_URL unset vs. a configured pool whose insert throws) so a
 * caller isn't left guessing from the count alone.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ...getTelemetryIngestDropStats(),
    poolConfigured: getTelemetryPg() !== null,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Guard 1 — before any parse.
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }

    const body = (await request.json().catch(() => null)) as Partial<TelemetryBatchRequest> | null;
    if (!body || !Array.isArray(body.events)) {
      return new NextResponse(null, { status: 400 });
    }

    // Guard 2.
    if (isBatchTooLarge(body.events)) {
      return new NextResponse(null, { status: 400 });
    }

    // Identity: resolved server-side, never taken from the body.
    const user = await getServerUser();

    // Guards 3–5.
    const now = Date.now();
    const { rows, rejections } = processBatch(body.events, now, user?.uid ?? null);

    // Guard 6 — a bot's whole batch is dropped, never inserted.
    const isBot = isBotUserAgent(request.headers.get("user-agent"));

    // Guard 7.
    const ip = resolveClientIpFromHeaders(request.headers);
    const { admitted, rejected: rateLimited } = isBot
      ? { admitted: [] as TelemetryRow[], rejected: [] }
      : partitionByRateLimit(rows, now, ip);

    if (rejections.length || rateLimited.length || isBot) {
      console.warn(
        `[telemetry] accepted ${admitted.length}/${body.events.length} ` +
          `(bot=${isBot}, invalid/size/dupe=${rejections.length}, rate_limited=${rateLimited.length})`,
      );
    }

    // Guard 8.
    await writeAdmittedRows(getTelemetryPg(), admitted);

    // Guard 9.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Guard 10 — telemetry failing must never break a page or surface a 500.
    console.error("[telemetry] ingest failed:", err);
    return new NextResponse(null, { status: 204 });
  }
}

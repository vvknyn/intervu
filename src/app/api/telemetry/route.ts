/**
 * POST /api/telemetry — thin I/O half. Decision-making lives in
 * `lib/telemetry/ingest.ts` (shape/size/name/clock/dedup) and
 * `lib/telemetry/rate-limit.ts` (per-session AND per-IP budgets); this file
 * only reads guards and identity off the Request, calls those, and inserts.
 *
 * Guard order follows SPEC §4 exactly:
 *   1. Content-Length, BEFORE request.json() — the container is a single
 *      `mem_limit: 1g` process (docker-compose.yml:22), so parsing an
 *      unbounded body first defeats the whole point of the cap.
 *   2. batch length > 50 -> 400
 *   3–5. per-event props/name/clock guards (ingest.processBatch)
 *   6. bot UA -> drop silently
 *   7. per-session AND per-IP rate limits (rate-limit.partitionByRateLimit)
 *   8. insert, ON CONFLICT (event_id) DO NOTHING, one multi-row statement,
 *      rows pre-sorted by event_id (unsorted multi-row upserts caused 7,318
 *      deadlocks in this codebase's history)
 *   9. always 204 — the endpoint returns no data, ever
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

/** Exported so a conformance test (`tests/unit/telemetry-column-conformance.test.ts`)
 *  can assert every `LEDGER_COLUMN_RULES` key is admitted into the insert
 *  column list — this array is otherwise the third hand-written enumeration
 *  of the 5 ledger columns (alongside `ingest.ts`'s guard chain and row
 *  builder), so it's the one place that gap could hide silently. */
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
 * True the FIRST time it is called with a missing pool and something to
 * drop; false on every call after that in this process. Without this gate,
 * a sustained `TELEMETRY_PG_URL`-unset misconfiguration would log once per
 * request forever — its own outage on a busy endpoint. Exported (with the
 * test-only reset below) so the decision is unit-testable without mocking
 * `getTelemetryPg`, `getServerUser`, or a Next `Request`.
 */
let missingPoolLogged = false;
export function shouldLogMissingPool(hasPool: boolean, admittedCount: number): boolean {
  if (hasPool || admittedCount === 0 || missingPoolLogged) return false;
  missingPoolLogged = true;
  return true;
}

/** Test-only reset — mirrors `clearTelemetryRateLimitStateForTests`. */
export function resetMissingPoolLogForTests(): void {
  missingPoolLogged = false;
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
    `insert into intervu.telemetry_events (${TELEMETRY_COLUMNS.join(", ")})
     values ${tuples.join(", ")}
     on conflict (event_id) do nothing`,
    values,
  );
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
    const pg = getTelemetryPg();
    if (pg && admitted.length > 0) {
      try {
        await insertRows(pg, admitted);
      } catch (err) {
        console.error("[telemetry] insert failed:", err);
      }
    } else if (shouldLogMissingPool(pg !== null, admitted.length)) {
      console.error(
        "[telemetry] no pg pool configured (TELEMETRY_PG_URL unset?) — admitted events are being " +
          "dropped silently; logging this once per process, not per request",
      );
    }

    // Guard 9.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Guard 10 — telemetry failing must never break a page or surface a 500.
    console.error("[telemetry] ingest failed:", err);
    return new NextResponse(null, { status: 204 });
  }
}

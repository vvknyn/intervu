/**
 * /trends' daily flow snapshot — the `dailyAdditions`/`dailyClosures`
 * mechanic openjobdata.com/statistics exposes via a real API, built here
 * with ZERO new infra: one Firestore doc per UTC day, written lazily off
 * the SAME `fetchMarketTrends` numbers the page already fetches (no extra
 * Meili cost), read back on the next render to show net day-over-day
 * movement.
 *
 * A snapshot diff is a NET number (today's active count minus yesterday's),
 * not true flow (it can't distinguish "3 new postings, 1 closed" from "2 net
 * new" — both look identical). Every render-site label says NET/newly-marked
 * accordingly (see `sinceLabel` and page.tsx) — the honesty-rules binding on
 * this whole feature.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { DAY_MS, todayUtcDateLabel } from "@/lib/jobs/day-buckets";

const SNAPSHOT_COLLECTION = "market_stats_daily";
/** Server-side read cap for the delta/tracking-since render — /trends never
 *  needs more than this to compute yesterday's delta and the first-seen date. */
const MAX_SNAPSHOTS_READ = 30;

export interface DailySnapshotDoc {
  /** YYYY-MM-DD, UTC — also this doc's Firestore id. */
  date: string;
  totalDocs: number;
  active: number;
  closed: number;
  /** ISO instant the snapshot was actually captured (may lag `date`'s UTC
   *  midnight by however long it took the first post-midnight ISR
   *  revalidation to fire). */
  capturedAt: string;
}

/** Pure: shape one day's snapshot doc from the same numbers `/trends`
 *  already fetched. Split out from the Firestore write below so the "what
 *  goes in the doc" decision is unit-testable without a database. */
export function buildDailySnapshotDoc(
  input: { totalDocs: number; active: number; closed: number },
  nowMs: number,
): DailySnapshotDoc {
  return {
    date: todayUtcDateLabel(nowMs),
    totalDocs: input.totalDocs,
    active: input.active,
    closed: input.closed,
    capturedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Pure: does a Firestore `.create()` failure mean "a snapshot already exists
 * for today" — expected under concurrent ISR revalidations racing the same
 * create, a no-op rather than an error — versus a genuine failure that's
 * worth a log line? The admin SDK surfaces Firestore's ALREADY_EXISTS
 * condition as a gRPC status-code-6 error on the thrown object (verified
 * against `@grpc/grpc-js`'s `Status.ALREADY_EXISTS = 6`, the constant
 * `@google-cloud/firestore` throws through unchanged).
 */
export function isAlreadyExistsError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 6;
}

function snapshotCollection() {
  return getAdminDb().collection(SNAPSHOT_COLLECTION);
}

/**
 * I/O: create today's snapshot doc if one doesn't already exist. `.create()`
 * is Firestore's atomic create-if-absent primitive — concurrent ISR
 * revalidations racing this can't double-write, no read-then-write check
 * needed. Never throws: a snapshot is an accretion, never a page-breaker
 * (module doc) — every failure (already-exists, or a genuine Firestore
 * error) is swallowed here, the one chokepoint, rather than at each caller.
 */
export async function captureDailySnapshotIfAbsent(
  input: { totalDocs: number; active: number; closed: number },
  nowMs: number = Date.now(),
): Promise<void> {
  const doc = buildDailySnapshotDoc(input, nowMs);
  try {
    await snapshotCollection().doc(doc.date).create(doc);
  } catch (err) {
    if (!isAlreadyExistsError(err)) {
      console.error("[daily-snapshot] create failed:", err);
    }
  }
}

/**
 * I/O: the last `MAX_SNAPSHOTS_READ` snapshot docs, ascending by date
 * (oldest first — the shape `computeLatestDelta` and the "tracking daily
 * since" render both want). Never throws — a read failure degrades to no
 * snapshot history rather than breaking the page (same non-fatal posture as
 * the write above).
 */
export async function readRecentSnapshots(): Promise<DailySnapshotDoc[]> {
  try {
    const snap = await snapshotCollection().orderBy("date", "desc").limit(MAX_SNAPSHOTS_READ).get();
    return snap.docs.map((d) => d.data() as DailySnapshotDoc).reverse();
  } catch (err) {
    console.error("[daily-snapshot] read failed:", err);
    return [];
  }
}

export interface SnapshotDelta {
  netActiveChange: number;
  newlyClosed: number;
  /** The earlier snapshot's date — the actual date this delta is measured
   *  from, which may NOT be exactly one day back (a missed revalidation
   *  leaves a gap). Render via `sinceLabel`, never assumed to be "yesterday". */
  sinceDate: string;
}

/**
 * Pure: net-active and newly-closed deltas between the two most recent
 * snapshots. `undefined` when fewer than two snapshots exist — never
 * fabricate a delta against a single data point (module doc: "no empty
 * promises" — see page.tsx, which renders nothing about deltas until this
 * resolves).
 */
export function computeLatestDelta(snapshotsAscending: DailySnapshotDoc[]): SnapshotDelta | undefined {
  if (snapshotsAscending.length < 2) return undefined;
  const [prev, latest] = snapshotsAscending.slice(-2);
  return {
    netActiveChange: latest.active - prev.active,
    newlyClosed: latest.closed - prev.closed,
    sinceDate: prev.date,
  };
}

function dayNumber(dateLabel: string): number {
  return Date.parse(`${dateLabel}T00:00:00Z`) / DAY_MS;
}

/**
 * Pure: human label for how long ago a delta's earlier snapshot was
 * captured. "yesterday" only when it's EXACTLY one UTC day back — the
 * expected daily cadence; a missed revalidation (or a backfill gap) states
 * the literal date instead of silently mislabeling a multi-day gap as
 * "yesterday" (honesty rules: every label must be literally true of its
 * number).
 */
export function sinceLabel(sinceDate: string, latestDate: string): string {
  return dayNumber(latestDate) - dayNumber(sinceDate) === 1 ? "yesterday" : sinceDate;
}

/**
 * Liveness demand (SERVER-ONLY): tell Subspace which listings people are
 * about to see and which ones they opened, so its verifier
 * (`verify-listings --demand-only`, every 10 minutes) probes those first. A
 * dead posting someone is looking at gets a second, corroborating probe an
 * hour later and closes; the closed-deletion feed then drops it from the
 * index, so it leaves every list without Velai deciding anything itself.
 *
 * Why Velai never checks a link itself: browser probes mostly come back
 * opaque (CORS, see apply-url-health.ts), and a server probe per row per
 * render would spend the 2-second list budget on someone else's career page.
 * The verdict, and the rule that a timeout, 403 or bot wall never hides a
 * listing, stays in Subspace with the corroboration gate.
 *
 * NEVER IN THE REQUEST PATH. `reportShownJobs` / `reportOpenedJob` only add
 * ids to an in-memory buffer (microseconds, no await); one timer flushes the
 * buffer as at most a couple of POSTs to `/jobs/liveness-demand` a few
 * seconds later. Every failure is logged and dropped: demand is a hint, and
 * the next render of the same list reports the same ids again.
 *
 * Bounded: an id is re-sent at most once per REPORT_TTL_MS per kind, the
 * buffer holds at most MAX_PENDING ids, and a rejected endpoint (404 before
 * Subspace ships it, 401/403 for a key without access) pauses reporting for
 * PAUSE_AFTER_REJECT_MS, so an undeployed endpoint costs one request per
 * pause, not one per search.
 */
import { hasSubspaceApiKey, postLivenessDemand, SubspaceJobsError } from "./subspaceJobs";

/** Rows per list reported as "shown": about one screen of results. */
export const SHOWN_IDS_PER_LIST = 20;
export const FLUSH_DELAY_MS = 5_000;
export const REPORT_TTL_MS = 15 * 60_000;
/** Subspace's own cap per request (DEMAND_MAX_IDS in liveness-demand.ts there). */
export const MAX_IDS_PER_BATCH = 500;
export const MAX_PENDING = 2_000;
export const PAUSE_AFTER_REJECT_MS = 10 * 60_000;
export const PAUSE_AFTER_FAILURE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_REMEMBERED = 20_000;
const REJECTED_STATUSES = new Set([401, 403, 404, 405]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DemandBatch {
  ids: string[];
  /** True for ids a person opened or reported; Subspace probes these ahead of
   *  ids that were only shown in a list. */
  urgent: boolean;
}

export interface DemandReporterDeps {
  send: (batch: DemandBatch) => Promise<unknown>;
  enabled?: () => boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
  log?: (message: string) => void;
}

export interface DemandReporter {
  reportShown(ids: Iterable<string>): void;
  reportOpened(id: string): void;
  /** Sends whatever is buffered now. The timer calls this; tests await it. */
  flush(): Promise<void>;
}

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

function chunk(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_BATCH) out.push(ids.slice(i, i + MAX_IDS_PER_BATCH));
  return out;
}

export function createDemandReporter(deps: DemandReporterDeps): DemandReporter {
  const enabled = deps.enabled ?? (() => true);
  const now = deps.now ?? Date.now;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      // unref: a pending flush must never hold a process (or a test run) open.
      setTimeout(fn, ms).unref?.();
    });
  const log = deps.log ?? ((message: string) => console.warn(message));

  const pending = { shown: new Set<string>(), urgent: new Set<string>() };
  /** `${kind}:${id}` -> when it was last handed to `send`. */
  const sentAt = new Map<string, number>();
  let pausedUntil = 0;
  let scheduled = false;

  const keyFor = (urgent: boolean, id: string) => `${urgent ? "u" : "s"}:${id}`;

  function add(ids: Iterable<string>, urgent: boolean): void {
    if (!enabled()) return;
    const t = now();
    if (t < pausedUntil) return;
    const target = urgent ? pending.urgent : pending.shown;
    for (const raw of ids) {
      if (pending.shown.size + pending.urgent.size >= MAX_PENDING) break;
      const id = normalizeId(raw);
      if (!id) continue;
      const last = sentAt.get(keyFor(urgent, id));
      if (last !== undefined && t - last < REPORT_TTL_MS) continue;
      target.add(id);
    }
    if (!scheduled && pending.shown.size + pending.urgent.size > 0) {
      scheduled = true;
      schedule(() => void flush(), FLUSH_DELAY_MS);
    }
  }

  function forget(): void {
    if (sentAt.size <= MAX_REMEMBERED) return;
    const cutoff = now() - REPORT_TTL_MS;
    for (const [key, t] of sentAt) if (t < cutoff) sentAt.delete(key);
    if (sentAt.size > MAX_REMEMBERED) sentAt.clear();
  }

  async function flush(): Promise<void> {
    scheduled = false;
    const urgentIds = [...pending.urgent];
    // An opened id is already going out as urgent; no need to send it twice.
    const shownIds = [...pending.shown].filter((id) => !pending.urgent.has(id));
    pending.urgent.clear();
    pending.shown.clear();

    const batches: DemandBatch[] = [
      ...chunk(urgentIds).map((ids) => ({ ids, urgent: true })),
      ...chunk(shownIds).map((ids) => ({ ids, urgent: false })),
    ];
    for (const batch of batches) {
      const t = now();
      if (t < pausedUntil) return;
      for (const id of batch.ids) sentAt.set(keyFor(batch.urgent, id), t);
      try {
        await deps.send(batch);
      } catch (e) {
        // Unmark so the next render of these rows reports them again.
        for (const id of batch.ids) sentAt.delete(keyFor(batch.urgent, id));
        const status = e instanceof SubspaceJobsError ? e.status : undefined;
        const rejected = status !== undefined && REJECTED_STATUSES.has(status);
        const pauseMs = rejected ? PAUSE_AFTER_REJECT_MS : PAUSE_AFTER_FAILURE_MS;
        pausedUntil = now() + pauseMs;
        log(
          `[liveness-demand] report failed (${e instanceof Error ? e.message : String(e)}); ` +
            `pausing ${Math.round(pauseMs / 1000)}s`,
        );
        return;
      }
    }
    forget();
  }

  return {
    reportShown: (ids) => add(ids, false),
    reportOpened: (id) => add([id], true),
    flush,
  };
}

const reporter = createDemandReporter({
  enabled: hasSubspaceApiKey,
  send: (batch) => postLivenessDemand(batch.ids, batch.urgent, { timeoutMs: REQUEST_TIMEOUT_MS }),
});

/** The first SHOWN_IDS_PER_LIST rows of a list a person is about to see. */
export function reportShownJobs(jobs: ReadonlyArray<{ id: string }> | null | undefined): void {
  if (!jobs?.length) return;
  reporter.reportShown(jobs.slice(0, SHOWN_IDS_PER_LIST).map((job) => job.id));
}

/** A listing a person opened, or reported as dead or filled. */
export function reportOpenedJob(id: string | null | undefined): void {
  if (id) reporter.reportOpened(id);
}

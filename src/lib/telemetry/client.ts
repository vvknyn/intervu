"use client";

/**
 * The client side of the telemetry ledger (SPEC.md §5, telemetry design
 * doc). `trackToLedger` is called from exactly ONE place —
 * `captureEvent` (lib/analytics/events.ts) — so every one of that
 * function's 22 event names reaches `POST /api/telemetry` for free, with no
 * second tracking call at any of its ~40 call sites. PostHog stays the
 * product-analytics tool; this ledger is the system of record.
 *
 * Owner split: `src/lib/telemetry/{types,ingest}.ts` and
 * `src/app/api/telemetry/route.ts` belong to a different lane and may not
 * exist on this branch yet. This file declares its OWN minimal wire shape
 * (`QueuedEvent` + the identity envelope stamped in `flush`) rather than
 * importing theirs — swap to the real shared type once it lands; the wire
 * body (`{ events: [...] }`) should be reconciled against whatever
 * `ingest.ts` actually expects.
 *
 * Batching: 1s debounce (reset on every new event, same pattern
 * `use-result-impressions.ts` already uses), capped at 50 events — a 51st
 * event flushes the first 50 immediately rather than waiting out the
 * debounce, so a burst can never grow the batch past the ingest route's own
 * cap (SPEC §4 item 2). `visibilitychange -> hidden` flushes immediately via
 * `sendBeacon` (survives the tab actually closing); every other flush uses
 * `fetch(..., { keepalive: true })`. Every failure — a thrown storage
 * access, a rejected fetch, a beacon the browser refuses to queue — is
 * dropped silently: telemetry must never surface an error to a visitor or
 * block a real interaction.
 *
 * Identity:
 * - `session_id`: sessionStorage, always.
 * - `visitor_id`: localStorage, EXCEPT a visitor resolved to the EU/UK, who
 *   gets sessionStorage instead (no durable id) until a consent choice
 *   exists. There is no consent-choice mechanism anywhere in this app yet
 *   (confirmed: no cookie-consent banner — posthog-options.ts/
 *   PostHogProvider.tsx's own doc comments) — so today that's simply
 *   "always sessionStorage for EU/UK," which is the correct, honest
 *   behaviour until a consent flow is built to graduate visitors out of it.
 *   The region signal reuses the app's EXISTING mmdb-backed geo path
 *   (`geo/ip-country.ts`'s `createMmdbCountryLookup`, already called from
 *   `actions/jobs.ts`) via a new thin route, `/api/geo/region` — no new
 *   geolocation dependency, no client-side IP lookup.
 * - `user_id`: the WorkOS uid when signed in, else `null` — read via
 *   `onAuthChange` (`lib/firebase/client-auth.ts`), the app's one client
 *   auth chokepoint (the same one `PostHogProvider` uses for
 *   `posthog.identify`). One-shot, like that call site — `onAuthChange`
 *   resolves "who is signed in right now" once; it is not a live listener
 *   (see its own doc comment), so a sign-in/out later in the same tab isn't
 *   picked up without a future reload. Matches the existing identify
 *   call's own fidelity rather than inventing a stronger guarantee here.
 */

import { onAuthChange } from "@/lib/firebase/client-auth";

const INGEST_URL = "/api/telemetry";
const REGION_URL = "/api/geo/region";
const FLUSH_DEBOUNCE_MS = 1000;
const MAX_BATCH = 50;
const SESSION_ID_KEY = "intervu.telemetry.session_id";
const VISITOR_ID_KEY = "intervu.telemetry.visitor_id";

/** One event as it goes out over the wire — see the module doc comment
 *  above for why this is a local stand-in rather than an imported type. */
interface LedgerEvent {
  event_id: string;
  event_name: string;
  props: Record<string, unknown>;
  occurred_at: string;
  session_id: string;
  visitor_id: string;
  user_id: string | null;
}

/** What `trackToLedger` actually has synchronously at capture time — the
 *  identity fields above aren't known yet (`visitor_id` needs an async
 *  region check on a brand-new visitor) so they're stamped once, in
 *  `flush`, onto the whole batch at send time rather than duplicated per
 *  call. */
type QueuedEvent = Pick<LedgerEvent, "event_id" | "event_name" | "props" | "occurred_at">;

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type StorageKind = "session" | "local";

function storageFor(kind: StorageKind): Storage {
  return kind === "session" ? window.sessionStorage : window.localStorage;
}

/** Safari private mode throws on ACCESS itself, not just on write — every
 *  storage touch gets its own try/catch rather than one wrapped around a
 *  read+write pair (a throwing read would otherwise skip the write's own
 *  guard). Mirrors `guest-store.ts`'s `read`/`write` idiom, generalized
 *  over storage kind. */
function safeGet(kind: StorageKind, key: string): string | null {
  try {
    return storageFor(kind).getItem(key);
  } catch {
    return null;
  }
}

function safeSet(kind: StorageKind, key: string, value: string): void {
  try {
    storageFor(kind).setItem(key, value);
  } catch {
    /* quota exceeded / private mode — the id just won't outlive this tab */
  }
}

/**
 * Pure: once a visitor's region is known, where does a NEW `visitor_id`
 * belong? Separated from the async region lookup and the storage I/O below
 * so the legal-risk rule itself is provable without a DOM or a network
 * call.
 */
export function resolveVisitorIdStorage(euUk: boolean): StorageKind {
  return euUk ? "session" : "local";
}

function getOrCreateSessionId(): string {
  const existing = safeGet("session", SESSION_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  safeSet("session", SESSION_ID_KEY, id);
  return id;
}

/** Fails CLOSED (treats the visitor as EU/UK) on any non-ok response or a
 *  network failure — an undetermined region is a legal-risk decision, not a
 *  UX one, so "assume the more restrictive storage rule applies" is the
 *  safe default, same posture as the route handler itself. */
async function resolveEuUk(): Promise<boolean> {
  try {
    const res = await fetch(REGION_URL, { cache: "no-store" });
    if (!res.ok) return true;
    const body = (await res.json()) as { euUk?: boolean };
    return body.euUk !== false;
  } catch {
    return true;
  }
}

let visitorIdPromise: Promise<string> | null = null;

function getOrCreateVisitorId(): Promise<string> {
  if (!visitorIdPromise) {
    visitorIdPromise = (async () => {
      // Already decided in an earlier call/page load this session — reuse
      // whichever storage already holds it rather than re-asking the region
      // (and never "upgrading" an existing session-scoped id to local: that
      // promotion is exactly the consent-choice step SPEC §5 says doesn't
      // exist yet).
      const fromSession = safeGet("session", VISITOR_ID_KEY);
      if (fromSession) return fromSession;
      const fromLocal = safeGet("local", VISITOR_ID_KEY);
      if (fromLocal) return fromLocal;

      const euUk = await resolveEuUk();
      const kind = resolveVisitorIdStorage(euUk);
      const id = randomId();
      safeSet(kind, VISITOR_ID_KEY, id);
      return id;
    })();
  }
  return visitorIdPromise;
}

// Best-effort snapshot of who's signed in, taken once at module load (same
// fidelity as PostHogProvider's own one-shot `onAuthChange` call) so it's
// very likely already resolved by the time the first debounced flush sends
// anything.
let currentUserId: string | null = null;
if (typeof window !== "undefined") {
  onAuthChange((user) => {
    currentUserId = user?.uid ?? null;
  });
  // Start the region check immediately rather than waiting for the first
  // event — minimizes the window in which a tab-close-triggered flush could
  // race an unresolved lookup (see `flush` below).
  void getOrCreateVisitorId();
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(useBeacon: boolean): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const sessionId = getOrCreateSessionId();
    const visitorId = await getOrCreateVisitorId();
    const events: LedgerEvent[] = batch.map((e) => ({
      ...e,
      session_id: sessionId,
      visitor_id: visitorId,
      user_id: currentUserId,
    }));
    const body = JSON.stringify({ events });

    if (useBeacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const queued = navigator.sendBeacon(INGEST_URL, new Blob([body], { type: "application/json" }));
      if (queued) return;
      // The browser refused to queue the beacon (payload too large, beacon
      // quota exhausted) — fall through to a best-effort keepalive fetch.
    }
    await fetch(INGEST_URL, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Silent drop, per SPEC §5 — telemetry must never surface an error to
    // the visitor or throw into a page's own code path.
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush(false);
  }, FLUSH_DEBOUNCE_MS);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush(true);
  });
}

/**
 * The one call site `captureEvent` makes. Enqueues synchronously (never
 * blocks the caller) and lets the debounce/cap above decide when the batch
 * actually goes out.
 */
export function trackToLedger(eventName: string, props: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  queue.push({
    event_id: randomId(),
    event_name: eventName,
    props,
    occurred_at: new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) {
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush(false);
    return;
  }
  scheduleFlush();
}

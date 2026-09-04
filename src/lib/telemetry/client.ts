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
 *
 * `user_id` is deliberately NOT sent from here — see `RawTelemetryEvent`'s
 * doc comment (`./types`): identity is stamped server-side from the
 * authenticated session, never client-suppliable, so this file has no
 * business reading who's signed in at all.
 */

import { LEDGER_COLUMN_RULES } from "./column-rules";

const INGEST_URL = "/api/telemetry";
const REGION_URL = "/api/geo/region";
const FLUSH_DEBOUNCE_MS = 1000;
const MAX_BATCH = 50;
const SESSION_ID_KEY = "intervu.telemetry.session_id";
const VISITOR_ID_KEY = "intervu.telemetry.visitor_id";

/** One event as it goes out over the wire — see the module doc comment
 *  above for why this is a local stand-in rather than an imported type. The
 *  5 optional fields mirror `RawTelemetryEvent`'s top-level, non-identity
 *  columns (`./types`) — they must land HERE, at the top level, not nested
 *  in `props`, or `ingest.ts`'s `parseEvent` never sees them and the ledger
 *  columns stay NULL forever. */
interface LedgerEvent {
  event_id: string;
  event_name: string;
  props: Record<string, unknown>;
  occurred_at: string;
  session_id: string;
  visitor_id: string;
  query_id?: string;
  job_id?: string;
  company_domain?: string;
  position?: number;
  source?: string;
}

/** What `trackToLedger` actually has synchronously at capture time — the
 *  identity fields (`session_id`, `visitor_id`) aren't known yet
 *  (`visitor_id` needs an async region check on a brand-new visitor) so
 *  they're stamped once, in `flush`, onto the whole batch at send time
 *  rather than duplicated per call. Everything else `LedgerEvent` carries
 *  (including the 5 promoted ledger columns) IS known synchronously, so it
 *  flows straight through `flush`'s `...e` spread with no extra wiring. */
type QueuedEvent = Omit<LedgerEvent, "session_id" | "visitor_id">;

/**
 * The 5 `LedgerEvent` fields that mirror top-level `telemetry_events`
 * columns (see `deploy/db-box/telemetry-schema.sql`) rather than living in
 * the `props` jsonb blob — derived by diffing `RawTelemetryEvent`'s
 * top-level fields (`./types`) against what was already top-level here;
 * these 5 are the remainder. Their admission rule lives in `LEDGER_COLUMN_RULES`
 * (`./column-rules`) — the same table `ingest.ts`'s `parseEvent` checks
 * server-side, so a value promoted here can never fail the server's shape
 * check for the same field.
 */
type LedgerColumns = {
  query_id?: string;
  source?: string;
  job_id?: string;
  company_domain?: string;
  position?: number;
};

/**
 * Pure: pulls the 5 ledger columns out of a `captureEvent` props object so
 * `trackToLedger` can promote them to the wire's top level instead of
 * leaving them nested where the server never looks. Never mutates `props`
 * — `captureEvent` hands the SAME object to `posthog.capture(...)` right
 * before this runs, so PostHog must still see every key it was given.
 *
 * A key present but failing its `LEDGER_COLUMN_RULES` predicate (e.g.
 * `position` sent as a non-integer, `query_id` sent as a non-UUID string)
 * is dropped from BOTH the returned `columns` and the returned `props` —
 * forwarding it in `props` would silently disguise a caller bug as "just
 * unindexed data," and putting it in `columns` would fail the server's
 * shape check for the WHOLE event (`parseEvent`, `./ingest`), not just this
 * one field.
 */
export function extractLedgerColumns(
  props: Record<string, unknown>,
): { columns: LedgerColumns; props: Record<string, unknown> } {
  const rest = { ...props };
  const columns: LedgerColumns = {};
  for (const key of Object.keys(LEDGER_COLUMN_RULES) as (keyof typeof LEDGER_COLUMN_RULES)[]) {
    if (!(key in rest)) continue;
    const value = rest[key];
    delete rest[key];
    if (LEDGER_COLUMN_RULES[key](value)) {
      (columns as Record<string, unknown>)[key] = value;
    }
  }
  return { columns, props: rest };
}

/** RFC-4122 v4 UUID from 16 cryptographically-random bytes — the shared
 *  core for both the `crypto.getRandomValues` path and the `Math.random`
 *  last resort below, so the version/variant-nibble bit-twiddling exists in
 *  exactly one place. */
function uuidV4FromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 8-b
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Fallback UUID generator for browsers without `crypto.randomUUID`
 * (older Safari, non-secure contexts). Exported directly so a test can
 * exercise it without deleting `globalThis.crypto.randomUUID` from a
 * shared global.
 *
 * `event_id`/`session_id`/`visitor_id` are all `uuid` columns
 * (`telemetry-schema.sql`) — the previous fallback
 * (`` `${Date.now()}-${random}` ``) didn't match that shape, so
 * `ingest.ts`'s `isUuid` rejected every event from an affected browser as
 * `invalid_shape`, silently and forever. `crypto.getRandomValues` is the
 * older half of Web Crypto and is present in every browser missing only
 * `randomUUID`; `Math.random()` is a last resort for an environment with no
 * Web Crypto at all.
 */
export function randomUuidFallback(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    return uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16)));
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return uuidV4FromBytes(bytes);
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : randomUuidFallback();
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

// Start the region check immediately rather than waiting for the first
// event — minimizes the window in which a tab-close-triggered flush could
// race an unresolved lookup (see `flush` below).
if (typeof window !== "undefined") {
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
  const { columns, props: strippedProps } = extractLedgerColumns(props);
  queue.push({
    event_id: randomId(),
    event_name: eventName,
    props: strippedProps,
    occurred_at: new Date().toISOString(),
    ...columns,
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

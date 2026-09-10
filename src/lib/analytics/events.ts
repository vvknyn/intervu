import posthog from "posthog-js";
import { trackToLedger } from "@/lib/telemetry/client";
import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import {
  ANALYTICS_EVENTS,
  type AnalyticsEventKey,
  type SignupMethod,
} from "@/lib/analytics/event-names";

/**
 * Wave-2 package F wired up the first six wire names (search → apply →
 * save/follow → signup). This module generalizes that same catalog to every
 * user action worth a funnel: job/company detail views, saves, shares,
 * search refinement, and application-stage moves. See docs/analytics/EVENTS.md
 * for the full taxonomy — event, payload, seam file, metric it feeds.
 *
 * ANALYTICS_EVENTS (re-exported here from the dependency-free
 * `event-names.ts`, so this stays a drop-in for every existing importer) is
 * the one place an event's wire name is decided. Every caller reaches a name
 * through captureEvent's `K` type parameter rather than typing the string
 * directly, so a rename can't land in one call site and not another.
 *
 * Does NOT call posthog.register({ product }) — PostHogProvider already
 * stamps that super-property once, right after init(); doing it again here
 * would just re-set the same value on every capture.
 */

export { ANALYTICS_EVENTS, type AnalyticsEventKey, type SignupMethod };

/** Where a job result/apply/view/share originated. */
export type EventSource = "serp" | "co" | "board" | "email" | "direct";

export interface EventPayloads {
  search_submitted: {
    query_length: number;
    has_location: boolean;
    filter_count: number;
  };
  result_clicked: {
    position: number;
    job_id: string;
    source: EventSource;
    /** The rendered result set this click came from — same uuid stamped on
     *  the `results_impressed` batch(es) it was scrolled into view by, so
     *  the ledger can compute a position-corrected CTR (SPEC §2/§5). Absent
     *  when there is no current search result set to attribute to (kept
     *  optional rather than a fabricated id — SERP always has one once a
     *  search has resolved). */
    query_id?: string;
  };
  apply_clicked: {
    job_id: string;
    source: EventSource;
    /** Same `query_id` contract as `result_clicked` above. */
    query_id?: string;
  };
  job_saved: {
    job_id: string;
  };
  company_followed: {
    company_domain: string;
  };
  auth_started: {
    reason: AuthGateReason;
  };
  signup_completed: {
    method: SignupMethod;
  };

  job_viewed: {
    job_id: string;
    company_domain: string | null;
    source: EventSource;
  };
  job_unsaved: {
    job_id: string;
  };
  job_marked_applied: {
    job_id: string;
  };
  job_shared: {
    job_id: string;
    method: "native" | "clipboard";
  };
  job_match_expanded: {
    job_id: string;
  };

  company_viewed: {
    company_domain: string;
  };
  company_unfollowed: {
    company_domain: string;
  };

  search_zero_results: {
    query_length: number;
    filter_count: number;
    /**
     * Every active filter's key and human-readable value, generic over
     * `FilterState` — never a per-facet field name enumerated here, so a
     * facet added later is captured by construction (see
     * `buildZeroResultPayload`, lib/jobs/result-state.ts, the pure builder
     * for this payload). This is structured filter state, not free text:
     * it already leaves the browser in PostHog's default `$current_url`
     * super-property on every pageview (the URL encodes the same facets/
     * values), so attaching it here adds no new data category — it only
     * makes an existing signal queryable at the moment a search fails,
     * instead of needing a human to notice a screenshot.
     */
    active_facets: { key: string; value: string }[];
    /** IP-based default location applied to this search (ISO2 country), or
     *  `null` when none was applied — mirrors `defaultedLocation` on the
     *  search response (actions/jobs.ts). Never the typed query text. */
    defaulted_location: string | null;
    /** Typed location text the resolver could not match to anything in the
     *  corpus and dropped (the "We don't recognize…" disclosure) — mirrors
     *  `unmatchedPlaceMentions` on the search response. Empty when nothing
     *  was dropped. The resolver's interpretation of a place it DID
     *  recognize is not included: that value (`places`, query-
     *  understanding.ts) is consumed only server-side to build the search
     *  filter and is never returned to the client today — see
     *  `buildZeroResultPayload`'s doc comment. */
    unmatched_place_mentions: string[];
  };
  search_filter_applied: {
    facet: string;
  };
  search_results_paged: {
    depth: number;
  };
  results_impressed: {
    job_ids: string[];
    /** 1-based rendered position for each entry in `job_ids`, same order —
     *  parallel arrays rather than `{job_id, position}[]` so this doesn't
     *  fork the existing `job_ids`/`count` dashboard shape (SPEC §5's
     *  position-fix requirement, applied without renaming the wire
     *  contract). */
    positions: number[];
    count: number;
    source: EventSource;
    /** The uuid identifying this rendered result set — same value carried
     *  by `result_clicked`/`apply_clicked` for the same SERP, the join key
     *  a position-corrected CTR needs (SPEC §2). Absent only when impressions
     *  fired with no resolved search (shouldn't happen in practice). */
    query_id?: string;
  };

  search_alert_impressed: {
    surface: "zero_results" | "results";
    query_length: number;
    filter_count: number;
    has_results: boolean;
  };
  search_alert_submitted: {
    surface: "zero_results" | "results";
    query_length: number;
    filter_count: number;
    has_results: boolean;
    outcome: "accepted" | "rejected";
  };
  search_alert_verified: {
    surface: "zero_results" | "results";
    query_length: number;
    filter_count: number;
    has_results: boolean;
  };
  search_alert_dismissed: {
    surface: "zero_results" | "results";
    query_length: number;
    filter_count: number;
    has_results: boolean;
  };

  application_stage_changed: {
    job_id: string;
    from_stage: string;
    to_stage: string;
  };
  resume_uploaded: Record<string, never>;
}

/**
 * Optional per-event props that reach ONLY the ledger (this repo's own
 * Postgres-backed telemetry store, `lib/telemetry/client.ts`) and are never
 * passed to `posthog.capture(...)` — for data too sensitive/raw for a
 * third-party analytics vendor but that we still need captured, keyed to
 * the account, server-side (privacy policy: "the searches you run,
 * including the text of what you typed").
 *
 * Only events that actually have ledger-only data get an entry here.
 * `captureEvent`'s third parameter is typed against this map so passing a
 * third argument for an event with no entry here fails to compile (typed
 * `never`), rather than silently accepting an untyped bag of props.
 */
export interface LedgerOnlyPayloads {
  search_submitted: {
    /** The raw, unmodified search query text. Ledger-only by construction —
     *  see `captureEvent` below — never forwarded to PostHog. */
    query_text: string;
  };
}

/**
 * Pure: should this call actually reach PostHog? Kept separate from the I/O
 * below — same pure-decision/thin-I/O split posthog-identity.ts uses for
 * identityAction — so the guard is testable without a DOM or a mocked
 * posthog-js.
 */
export function shouldCaptureEvent(hasWindow: boolean, loaded: boolean): boolean {
  return hasWindow && loaded;
}

/**
 * The whole `ledgerOnly` object's SERIALIZED (`JSON.stringify`) size is
 * bounded to this many characters — never a per-value raw-character-count
 * cap. Two things a per-value cap gets wrong:
 *
 *  1. `JSON.stringify` inflates control characters ~6x (each becomes a
 *     6-byte `\uXXXX` escape) — a 200-*character* string can serialize to
 *     1200+ characters, so a per-value bound keyed on raw `.length` is not a
 *     safe proxy for the thing that actually matters: the serialized size
 *     that lands in `props` and counts against `MAX_PROPS_LENGTH`
 *     (`lib/telemetry/ingest.ts`).
 *  2. The real budget is per-PAYLOAD, not per-value: a per-value cap stops
 *     protecting anything the moment a second ledger-only field is added,
 *     since two individually-safe values can jointly overflow the shared
 *     budget. Bounding the whole object closes that gap by construction —
 *     it is re-checked (and, if needed, shrunk further) regardless of how
 *     many keys `ledgerOnly` carries.
 *
 * Set well below `MAX_PROPS_LENGTH` (a quarter of it) so there is always
 * room left in `props` for the rest of the event's payload — see
 * `tests/unit/events.test.ts` for the test that ties these two constants
 * together (this file cannot import `ingest.ts` — see the module doc
 * comment on `column-rules.ts` for why: browser code must stay zero-import
 * of server-only modules).
 */
export const LEDGER_ONLY_PROPS_BUDGET = 1024;

/**
 * Pure: builds what the ledger's `trackToLedger` call receives, merging in
 * any ledger-only props — kept out of `captureEvent` itself so this merge
 * is unit-testable without a DOM or a mocked posthog-js, same
 * pure-decision/thin-I/O split as `shouldCaptureEvent` above and
 * `extractLedgerColumns` (lib/telemetry/client.ts). `payload` is returned
 * as-is (not copied) when there's no `ledgerOnly` to merge, so every
 * existing call site — which never passes a third argument — sends the
 * ledger byte-for-byte what it always did.
 *
 * Shrinks whichever string value in `ledgerOnly` is currently longest,
 * repeatedly, until the WHOLE object's serialized form fits
 * `LEDGER_ONLY_PROPS_BUDGET` — generically, over the object as a whole,
 * never a fixed per-value length and never keyed by name, so this covers
 * any number of ledger-only fields of any (string-bearing) shape. When
 * anything was actually shrunk, `ledger_truncated: true` is added to the
 * result so the fact is visible in the stored data rather than silently
 * lossy; nothing is fabricated or padded when it wasn't.
 */
export function buildLedgerProps(
  payload: Record<string, unknown>,
  ledgerOnly?: Record<string, unknown>,
): Record<string, unknown> {
  if (!ledgerOnly) return payload;

  const bounded: Record<string, unknown> = { ...ledgerOnly };
  let truncated = false;

  while (JSON.stringify(bounded).length > LEDGER_ONLY_PROPS_BUDGET) {
    let longestKey: string | null = null;
    let longestLength = 0;
    for (const [key, value] of Object.entries(bounded)) {
      if (typeof value === "string" && value.length > longestLength) {
        longestKey = key;
        longestLength = value.length;
      }
    }
    // Nothing left worth shrinking (no strings, or all already empty) —
    // stop rather than loop forever without reducing anything.
    if (longestKey === null || longestLength === 0) break;

    bounded[longestKey] = (bounded[longestKey] as string).slice(0, Math.floor(longestLength / 2));
    truncated = true;
  }

  return truncated ? { ...payload, ...bounded, ledger_truncated: true } : { ...payload, ...bounded };
}

/**
 * The only I/O in this module. Typed via EventPayloads so a call site that
 * gets an event's payload shape wrong fails to compile.
 *
 * Mirrors PostHogProvider's own guard: SSR-safe (`typeof window ===
 * "undefined"`), and a safe no-op when PostHog was never initialized (no
 * NEXT_PUBLIC_POSTHOG_KEY -> posthog.init() never ran -> posthog.__loaded
 * stays false) — no throw, no console spam beyond whatever posthog-js does
 * internally.
 *
 * The ONE chokepoint every event passes through — `trackToLedger`
 * (lib/telemetry/client.ts) rides the same guarded branch as the PostHog
 * capture, so every one of this module's 24 event names reaches the
 * telemetry ledger for free, and a future 23rd does too, with no second
 * tracking call to add at any call site (SPEC.md §5).
 *
 * `ledgerOnly` is the optional third argument for props that must reach
 * the ledger but must NEVER reach PostHog (`LedgerOnlyPayloads` above) —
 * the two sinks differ by construction: `posthog.capture` is called with
 * `payload` alone, on the line directly above, before `ledgerOnly` is ever
 * referenced. There is no code path here that could hand `ledgerOnly` to
 * PostHog.
 */
export function captureEvent<K extends AnalyticsEventKey>(
  event: K,
  payload: EventPayloads[K],
  ledgerOnly?: K extends keyof LedgerOnlyPayloads ? LedgerOnlyPayloads[K] : never,
): void {
  const hasWindow = typeof window !== "undefined";
  if (!shouldCaptureEvent(hasWindow, posthog.__loaded === true)) return;
  posthog.capture(ANALYTICS_EVENTS[event], payload);
  trackToLedger(
    ANALYTICS_EVENTS[event],
    buildLedgerProps(payload as Record<string, unknown>, ledgerOnly as Record<string, unknown> | undefined),
  );
}

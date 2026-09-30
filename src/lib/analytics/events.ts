import posthog from "posthog-js";
import { trackToLedger } from "@/lib/telemetry/client";
import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { AuthContinuityFields, AuthEventContext } from "@/lib/analytics/auth-event-payload";
import type {
  ResumeErrorClass,
  ResumeFileType,
  ResumeFunnelReason,
  ResumeInputSource,
  ResumeParserEngine,
  ResumeSizeBucket,
} from "@/lib/analytics/resume-funnel";
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

/** Which form's Turnstile widget failed — one entry per `<TurnstileWidget surface>` call site. */
export type TurnstileSurface = "signup" | "contact" | "waitlist" | "follow_email" | "search_alert";

/** Where a job result/apply/view/share originated. */
export type EventSource = "serp" | "co" | "board" | "email" | "direct";

/** Match-quality fields shared by job funnel events — all optional and omitted
 *  entirely when no résumé score exists (never null or a fabricated 0). */
export type MatchQualityAnalyticsProps = {
  match_label: "Strong" | "Good" | "Stretch";
  match_score: number;
  match_band: "strong" | "good" | "stretch";
};

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
  } & Partial<MatchQualityAnalyticsProps>;
  apply_clicked: {
    job_id: string;
    source: EventSource;
    /** Same `query_id` contract as `result_clicked` above. */
    query_id?: string;
  } & Partial<MatchQualityAnalyticsProps>;
  job_saved: {
    job_id: string;
  } & Partial<MatchQualityAnalyticsProps>;
  company_followed: {
    company_domain: string;
  };
  auth_started: AuthEventContext;
  auth_nudge_shown: AuthEventContext;
  auth_method_selected: AuthContinuityFields & {
    method: SignupMethod;
  };
  signup_completed: AuthContinuityFields & {
    method: SignupMethod;
  };
  /** Server-side only (src/app/auth/callback/route.ts). `code` is the CallbackError code, never a credential. */
  auth_callback_failed: { code: string };
  /** Client-side, from the one Turnstile wrapper (components/ui/turnstile-widget.tsx). `code` is Cloudflare's numeric error code (e.g. "110200") or "script_load_failed" — never user input. */
  turnstile_error: { code: string; surface: TurnstileSurface };

  job_viewed: {
    job_id: string;
    company_domain: string | null;
    source: EventSource;
  } & Partial<MatchQualityAnalyticsProps>;
  job_unsaved: {
    job_id: string;
  };
  job_marked_applied: {
    job_id: string;
  } & Partial<MatchQualityAnalyticsProps>;
  job_shared: {
    job_id: string;
    method: "native" | "clipboard";
  };
  job_match_expanded: {
    job_id: string;
  } & Partial<MatchQualityAnalyticsProps>;

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
     *  corpus and dropped (the "We have no roles in…" disclosure) — mirrors
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
  resume_uploaded: { surface?: string };

  resume_gate_shown: ResumeFunnelEventPayload;
  resume_upload_started: ResumeFunnelEventPayload;
  resume_upload_selected: ResumeFunnelEventPayload;
  resume_upload_accepted: ResumeFunnelEventPayload;
  resume_upload_rejected: ResumeFunnelEventPayload;
  resume_parse_started: ResumeFunnelEventPayload;
  resume_parse_succeeded: ResumeFunnelEventPayload;
  resume_parse_failed: ResumeFunnelEventPayload;
  resume_review_completed: ResumeFunnelEventPayload;

  /** /pricing mounted. `founding_available` is whether the founding-seat
   *  button pointed at a real Stripe link (env var set) or read "opening
   *  soon" — the denominator for `upgrade_clicked` is only the former. */
  pricing_viewed: { signed_in: boolean; founding_available: boolean };
  /** A priced call to action on /pricing was clicked. `plan` names the
   *  column: `pro_founding` is the founding-seat button, `data_api` is the
   *  Data API "tell us your use case" link. `mode` says what the founding
   *  button did: `checkout` (leaving for Stripe) or `reserve` (the
   *  email-only reservation shown while the Stripe link is unset). No
   *  amounts — the price is a page constant, not a payload. */
  upgrade_clicked: { plan: UpgradePlan; signed_in: boolean; mode?: "checkout" | "reserve" };
  /** The visitor came back from Stripe with `checkout=success` and a
   *  well-formed session id (`paidCheckoutSessionId`, lib/billing). The id
   *  is Stripe's, not PII, and is what joins this event to the Stripe
   *  dashboard row. Fired once per session id per browser session. */
  founding_member_paid: { checkout_session_id: string; signed_in: boolean };
  /** The reservation form on /pricing (shown while the Stripe link is
   *  unset) saved an address. No email in the payload; the row is in
   *  Firestore `founding_waitlist` and counted on /admin. */
  founding_seat_reserved: { signed_in: boolean };
  /** The pay-it-forward button on a tracker pursuit in the Offer lane was
   *  clicked (the person is leaving for Stripe). `job_id` is null for a
   *  hand-tracked role, as in `application_stage_changed`. Stripe is the
   *  ledger; this only joins the click to a PostHog person. */
  landed_pledge_clicked: { job_id: string | null };
}

export type UpgradePlan = "pro_founding" | "data_api";

export interface ResumeFunnelEventPayload {
  reason?: ResumeFunnelReason;
  source?: ResumeInputSource;
  file_type?: ResumeFileType;
  size_bucket?: ResumeSizeBucket;
  latency_ms?: number;
  duration_ms?: number;
  parser_source?: ResumeParserEngine;
  engine?: ResumeParserEngine;
  error_class?: ResumeErrorClass;
  error_code?: ResumeErrorClass;
  surface?: string;
  signed_in?: boolean;
  section_count?: number;
  warning_count?: number;
  edited?: boolean;
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
 * Pure: an event fired in the browser before PostHog has loaded is HELD,
 * not dropped. PostHog loads after the page (`DeferredPostHogProvider`, on
 * load or idle), so everything a page fires as it mounts (`company_viewed`,
 * `pricing_viewed`, a first `job_viewed`) comes before it. Those used to be
 * lost, and only reached PostHog when the late provider rebuilt the whole
 * page and fired them again.
 */
export function captureRoute(hasWindow: boolean, loaded: boolean): "send" | "hold" | "drop" {
  if (!hasWindow) return "drop";
  return loaded ? "send" : "hold";
}

/** Held events past this many are dropped: a page that never loads PostHog (no key) holds at most this. */
export const PRE_INIT_EVENT_LIMIT = 50;

interface HeldEvent {
  name: string;
  payload: Record<string, unknown>;
  ledger: Record<string, unknown>;
  at: Date;
}

const heldEvents: HeldEvent[] = [];

/**
 * The only I/O in this module. Typed via EventPayloads so a call site that
 * gets an event's payload shape wrong fails to compile.
 *
 * SSR-safe (`typeof window === "undefined"`), and a safe no-op when PostHog
 * was never initialized (no NEXT_PUBLIC_POSTHOG_KEY -> posthog.init() never
 * ran -> posthog.__loaded stays false): the event waits in a bounded hold
 * that nothing flushes — no throw, no console spam beyond whatever
 * posthog-js does internally. Before PostHog loads, events wait in that hold
 * until `PostHogProvider` calls `flushHeldEvents()` (see `captureRoute`).
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
 * `payload` alone, and a held event keeps the ledger's props in their own
 * field that `flushHeldEvents` hands only to `trackToLedger`. There is no
 * code path here that could hand `ledgerOnly` to PostHog.
 */
export function captureEvent<K extends AnalyticsEventKey>(
  event: K,
  payload: EventPayloads[K],
  ledgerOnly?: K extends keyof LedgerOnlyPayloads ? LedgerOnlyPayloads[K] : never,
): void {
  const route = captureRoute(typeof window !== "undefined", posthog.__loaded === true);
  if (route === "drop") return;
  const name = ANALYTICS_EVENTS[event];
  if (route === "hold") {
    if (heldEvents.length >= PRE_INIT_EVENT_LIMIT) return;
    heldEvents.push({
      name,
      payload: payload as Record<string, unknown>,
      ledger: buildLedgerProps(payload as Record<string, unknown>, ledgerOnly as Record<string, unknown> | undefined),
      at: new Date(),
    });
    return;
  }
  posthog.capture(name, payload);
  trackToLedger(
    name,
    buildLedgerProps(payload as Record<string, unknown>, ledgerOnly as Record<string, unknown> | undefined),
  );
}

/**
 * Sends the events held before PostHog loaded, each at the time it happened.
 * `PostHogProvider` calls it right after `posthog.init`; a call before then
 * does nothing, so the hold stays for the next one.
 */
export function flushHeldEvents(): void {
  if (!shouldCaptureEvent(typeof window !== "undefined", posthog.__loaded === true)) return;
  for (const held of heldEvents.splice(0)) {
    posthog.capture(held.name, held.payload, { timestamp: held.at });
    trackToLedger(held.name, held.ledger);
  }
}

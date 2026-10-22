/**
 * Subspace Company Change-Events API client (SERVER-ONLY).
 *
 * Read-only client for `GET /companies/{domain}/events` — the per-company,
 * published-only view of Subspace's change-event ledger (hiring surges and
 * freezes, funding, layoffs, verdict changes). Same auth/base-URL conventions
 * and the same FAIL-SOFT contract as its sibling `news.ts`: any non-2xx
 * status, network error, timeout or malformed body resolves to an empty array.
 * A company page with no events section is correct; a broken company page is
 * not.
 *
 * Deliberately NOT the firehose `GET /events`. That endpoint is enterprise-
 * keyed because the ledger in bulk is the paid intent product; this one is
 * scoped to a single domain and sits on the public tier, so the public jobs
 * frontend never needs a credential that would also unlock health scores,
 * forensic traces and AI narratives.
 */
import { hasSubspaceApiKey, subspaceApiBase } from "@/lib/jobs/subspaceJobs";
import type { CompanyChangeEvent } from "./types";

const FETCH_TIMEOUT_MS = 2500;
const EVENT_LIMIT = 6;

/**
 * `hiring_freeze` → "Hiring freeze".
 *
 * Derived from the ledger's own snake_case vocabulary rather than a
 * `Record<EventType, string>` lookup: the taxonomy lives in the other repo, so
 * a map here would render a brand-new event type as blank (or throw) on the
 * day it ships, while this degrades to a readable label for anything the
 * projector can emit. The same reason `CompanyChangeEvent.event_type` is a
 * string and not a union.
 */
export function eventTypeLabel(eventType: string): string {
  // Trim AFTER substituting, never before: a stray "_" trims to "_" and then
  // substitutes to " ", which is truthy — the component would draw an empty
  // chip rather than skip it. Collapsing runs also keeps "__a__b__" readable.
  const words = eventType.replace(/_+/g, " ").trim();
  if (words === "") return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * "health outlook changed to actively_hiring" → "health outlook changed to
 * actively hiring".
 *
 * `headline` is the projector's prose, verbatim — this repo never rewords or
 * re-cases it. But the projector composes some headlines by interpolating its
 * own snake_case enum vocabulary (the same vocabulary `eventTypeLabel` reads
 * for the chip) straight into the sentence, so a raw enum token can leak into
 * copy that is otherwise a normal sentence. This normalizes only that: runs
 * of underscores become a single space. No trimming, no case changes, no
 * rewording — this is the one seam every projector-headline render routes
 * through, so a future projector headline gets the same treatment without a
 * caller having to know why.
 */
export function humanizeProjectorHeadline(headline: string): string {
  return headline.replace(/_+/g, " ");
}

interface CompanyEventsEnvelope {
  data?: {
    domain?: string;
    events?: CompanyChangeEvent[];
  };
}

/**
 * An event we are willing to put on a page: it says something, and it says
 * when.
 *
 * Both halves are load-bearing. A row with no headline renders a dated bullet
 * with no statement in it; a row with no date renders a claim about a company
 * with no way to tell whether it describes last week or last year — and a
 * stale hiring-freeze presented undated is materially misleading. The server
 * already drops empty headlines; this is the seam guard, so a future server
 * change cannot quietly put either shape on the page.
 *
 * The date is validated by parsing, not by regex: an unparseable string would
 * otherwise reach `toLocaleDateString` and render "Invalid Date".
 */
function isRenderableEvent(e: CompanyChangeEvent): boolean {
  if (typeof e?.headline !== "string" || e.headline.trim() === "") return false;
  if (typeof e?.event_type !== "string" || e.event_type.trim() === "") return false;
  if (typeof e?.occurred_at !== "string") return false;
  return Number.isFinite(new Date(e.occurred_at).getTime());
}

/** Recent published change-events for a domain. Fails soft to `[]`. */
export async function fetchCompanyEvents(domain: string): Promise<CompanyChangeEvent[]> {
  if (!hasSubspaceApiKey()) return [];

  const url = new URL(`${subspaceApiBase()}/companies/${encodeURIComponent(domain)}/events`);
  url.searchParams.set("limit", String(EVENT_LIMIT));

  try {
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": process.env.SUBSPACE_API_KEY as string, accept: "application/json" },
      // The projector runs hourly and these events describe 14-day windows, so
      // an hour-old view is never materially stale. Matches `fetchCompanyNews`
      // so both upstream calls on this page share one cache policy.
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    // Includes 404 (endpoint not deployed yet) — fail soft, not an error state.
    if (!res.ok) return [];

    const body = (await res.json()) as CompanyEventsEnvelope;
    if (!Array.isArray(body?.data?.events)) return [];
    return body.data.events.filter(isRenderableEvent);
  } catch {
    // Network error, timeout/abort, or malformed JSON — never break the page.
    return [];
  }
}

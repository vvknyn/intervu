import { trackEvent } from "@/lib/analytics";
import { captureEvent } from "@/lib/analytics/events";

/**
 * Decision logic for the one reusable share control (`ShareAction`,
 * components/ui/share-action.tsx) and the account-menu "Share Velai" item
 * (TopBar.tsx) — both call `performShare` below rather than each
 * reimplementing "try the native sheet, fall back to clipboard, report the
 * outcome," which is exactly the kind of parallel mechanism that drifts.
 *
 * Split into pure functions + one thin I/O wrapper (`performShare`) so the
 * decisions are unit-testable without mocking `navigator` or `trackEvent`.
 */

export type ShareSurface = "job" | "app";
export type ShareMethod = "native" | "clipboard";
export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** Pure: which mechanism to attempt, given what the runtime exposes. Native
 *  share wins when both are available — it's the richer surface (share
 *  sheet with the OS's own app targets) and clipboard is the fallback. */
export function chooseShareMethod(hasNativeShare: boolean, hasClipboard: boolean): ShareMethod | "unsupported" {
  if (hasNativeShare) return "native";
  if (hasClipboard) return "clipboard";
  return "unsupported";
}

/**
 * Pure: classifies what happened after a share/copy attempt. `error` is
 * `null` on success. The native share sheet's own cancel throws
 * `AbortError` — a user decision, not a failure — so it gets its own
 * outcome (no failure UI, no analytics event) instead of being lumped into
 * "failed" alongside a genuinely denied/unavailable clipboard write.
 */
export function classifyShareOutcome(method: ShareMethod, error: unknown): ShareOutcome {
  if (!error) return method === "native" ? "shared" : "copied";
  if (method === "native" && error instanceof DOMException && error.name === "AbortError") {
    return "cancelled";
  }
  return "failed";
}

/** Pure: the one place the "never report a cancel or a failure" rule lives —
 *  `performShare` is the only caller. */
export function shouldTrackShare(outcome: ShareOutcome): boolean {
  return outcome === "shared" || outcome === "copied";
}

/** Pure: builds the shared URL with its attribution surface tag appended.
 *  A surface label only (`share_job` / `share_app`) — never a per-user
 *  token, per the hard rule against personal data in query strings. */
export function withShareRef(url: string, surface: ShareSurface): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}ref=share_${surface}`;
}

/** Pure: recovers the attribution surface from a `ref=share_<surface>`
 *  query param (see `withShareRef`) — lets `performShare` report which
 *  surface a share came from without either call site passing a redundant
 *  `surface` prop of its own. Returns `null` for a malformed or untagged
 *  URL rather than throwing. */
export function shareSurfaceFromUrl(url: string): ShareSurface | null {
  try {
    const ref = new URL(url).searchParams.get("ref");
    if (ref === "share_job") return "job";
    if (ref === "share_app") return "app";
    return null;
  } catch {
    return null;
  }
}

export interface ShareRequest {
  title: string;
  text: string;
  url: string;
  /** Present only for a job-surface share — routes the capture through the
   *  typed `job_shared` catalog entry (with `job_id`) instead of the untyped
   *  `share_initiated` fallback below. */
  jobId?: string;
}

/**
 * Thin I/O wrapper: attempts the share, classifies the result, and reports
 * it to analytics when warranted. The only place that touches
 * `navigator.share` / `navigator.clipboard` / `trackEvent` — everything
 * else here is pure and unit-tested directly.
 */
export async function performShare(request: ShareRequest): Promise<ShareOutcome> {
  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const hasClipboard = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
  const method = chooseShareMethod(hasNativeShare, hasClipboard);

  if (method === "unsupported") return "failed";

  let error: unknown = null;
  try {
    if (method === "native") {
      await navigator.share(request);
    } else {
      await navigator.clipboard.writeText(`${request.text}\n\n${request.url}`);
    }
  } catch (e) {
    error = e;
  }

  const outcome = classifyShareOutcome(method, error);
  if (shouldTrackShare(outcome)) {
    const surface = shareSurfaceFromUrl(request.url);
    if (surface === "job" && request.jobId) {
      captureEvent("job_shared", { job_id: request.jobId, method });
    } else if (surface) {
      trackEvent("share_initiated", { surface, method });
    }
  }
  return outcome;
}

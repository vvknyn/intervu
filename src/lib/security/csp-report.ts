/**
 * Reading Content-Security-Policy violation reports.
 *
 * The site sends a report-only policy (next.config.ts, CONTENT_SECURITY_POLICY)
 * so a directive that would break something shows up as a report instead of a
 * broken page. A report nobody can read is not a trial run, so the browser is
 * told to POST them to /api/csp-report, which logs one `[csp-report]` line per
 * violation using the reader below.
 *
 * Two wire formats exist and browsers send either:
 *   - `report-uri` (legacy): `application/csp-report`, `{"csp-report": {...}}`,
 *     dashed keys (`violated-directive`, `blocked-uri`).
 *   - Reporting API (`report-to`): `application/reports+json`, an array of
 *     `{type: "csp-violation", url, body: {...}}`, camelCase keys.
 *
 * Privacy: a report carries the page's address and the blocked resource's
 * address, and both can hold a search query or a token. Only the path of the
 * page and the ORIGIN of a blocked resource are kept, and every string is cut
 * short, so the log says which rule a page hit without recording what the
 * visitor was doing.
 */

export interface CspViolation {
  /** The directive that was hit, e.g. `script-src-elem`. */
  directive: string;
  /** `inline`, `eval`, `data`, `blob`, or the blocked resource's origin. */
  blocked: string;
  /** The path of the page that was being viewed (no query, no fragment). */
  page: string;
  /** File that triggered it (path only), if the browser said. */
  source: string;
  /** `report` for a report-only policy, `enforce` for an enforced one. */
  disposition: string;
}

const MAX_FIELD = 200;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string): string {
  return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
}

/** The path of an address, or "" when it is not an address. */
function pathOf(address: string): string {
  try {
    return new URL(address).pathname;
  } catch {
    return "";
  }
}

/** What a blocked address is called in the log: a keyword stays a keyword, an address becomes its origin. */
function blockedLabel(blocked: string): string {
  if (!blocked) return "";
  if (/^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink)$/.test(blocked)) return blocked;
  if (/^(data|blob|about|filesystem):/.test(blocked)) return blocked.split(":")[0];
  try {
    const url = new URL(blocked);
    return url.origin === "null" ? url.protocol.replace(":", "") : url.origin;
  } catch {
    return clip(blocked);
  }
}

function fromBody(body: Record<string, unknown>, pageFallback: string): CspViolation | null {
  const directive = asString(body["effectiveDirective"] ?? body["effective-directive"] ?? body["violatedDirective"] ?? body["violated-directive"]);
  if (!directive) return null;
  const page = asString(body["documentURL"] ?? body["document-uri"] ?? body["documentUri"]) || pageFallback;
  return {
    directive: clip(directive.split(/\s+/)[0]),
    blocked: blockedLabel(asString(body["blockedURL"] ?? body["blocked-uri"] ?? body["blockedUri"])),
    page: clip(pathOf(page) || "/"),
    source: clip(pathOf(asString(body["sourceFile"] ?? body["source-file"])) || ""),
    disposition: asString(body["disposition"]) === "enforce" ? "enforce" : "report",
  };
}

/** The violations in a parsed report body, in either wire format; anything else yields none. */
export function readCspReports(payload: unknown): CspViolation[] {
  const found: CspViolation[] = [];
  const entries = Array.isArray(payload) ? payload : [payload];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const legacy = record["csp-report"];
    if (legacy && typeof legacy === "object") {
      const v = fromBody(legacy as Record<string, unknown>, "");
      if (v) found.push(v);
    } else if (record["type"] === "csp-violation" && record["body"] && typeof record["body"] === "object") {
      const v = fromBody(record["body"] as Record<string, unknown>, asString(record["url"]));
      if (v) found.push(v);
    }
  }
  return found;
}

/** How many lines one process logs per window; the rest are counted, not written. */
export const CSP_LOG_BUDGET = 60;
export const CSP_LOG_WINDOW_MS = 60_000;

/**
 * A fixed-window budget for log lines. A page that breaks one rule breaks it on
 * every view, so without a cap one bad directive would write a line per visit and
 * bury the log the reports are meant to be read in. Pure: the caller passes the
 * clock, so it is tested without waiting.
 */
export function createCspLogBudget(max = CSP_LOG_BUDGET, windowMs = CSP_LOG_WINDOW_MS) {
  let windowStart = 0;
  let used = 0;
  let dropped = 0;
  return {
    /** True when this line may be written; false when the window's budget is spent. */
    take(now: number): { allowed: boolean; droppedBefore: number } {
      let droppedBefore = 0;
      if (now - windowStart >= windowMs) {
        droppedBefore = dropped;
        windowStart = now;
        used = 0;
        dropped = 0;
      }
      if (used < max) {
        used += 1;
        return { allowed: true, droppedBefore };
      }
      dropped += 1;
      return { allowed: false, droppedBefore };
    },
  };
}

/** One log line for a violation. */
export function formatCspLogLine(v: CspViolation): string {
  return `[csp-report] ${JSON.stringify(v)}`;
}

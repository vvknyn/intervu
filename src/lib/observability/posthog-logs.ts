/**
 * Server logs -> PostHog Logs, over plain OTLP/JSON.
 *
 * No OpenTelemetry SDK: PostHog Logs accepts standard OTLP over HTTP with the
 * project token as a Bearer header (https://posthog.com/docs/logs/installation/other),
 * and `lib/analytics/server-capture.ts` already set the precedent of a plain
 * `fetch` to PostHog instead of a new dependency.
 *
 * Volume is the constraint, not the transport (free plan, 10 GB/month, usage
 * stops at the cap): only warn and error are exported unless
 * `POSTHOG_LOGS_LEVEL=info` opts in, and a per-window budget drops an error
 * storm instead of spending the month's allowance in an hour.
 *
 * A no-op (no fetch, no throw) unless `POSTHOG_LOGS_ENABLED` is on AND the
 * project token is present. The token is the SAME public write-only key the
 * browser SDK and `server-capture.ts` use (`NEXT_PUBLIC_POSTHOG_KEY`), so there
 * is one place it is configured.
 *
 * Never put PII in `attrs`/`body`: no emails, resume text, tokens, query
 * strings. Free-form error text goes through `scrubMessage`.
 */

export type LogLevel = "info" | "warn" | "error";

export const SERVICE_NAME = "velai-web";
export const DEFAULT_LOGS_ENDPOINT = "https://us.i.posthog.com/i/v1/logs";

/** OTLP severity numbers (INFO=9, WARN=13, ERROR=17) — also the level order. */
const SEVERITY: Record<LogLevel, number> = { info: 9, warn: 13, error: 17 };

const MAX_LOGS_PER_WINDOW = 60;
const WINDOW_MS = 60_000;
const MAX_MESSAGE_CHARS = 300;

type Env = Readonly<Record<string, string | undefined>>;

export type LogsConfig = {
  endpoint: string;
  token: string;
  minLevel: LogLevel;
  environment: string;
};

/** Pure: null (= no-op) unless explicitly enabled and a token is present. */
export function resolveLogsConfig(env: Env): LogsConfig | null {
  const enabled = env.POSTHOG_LOGS_ENABLED?.trim().toLowerCase();
  if (enabled !== "1" && enabled !== "true") return null;
  const token = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!token) return null;
  const level = env.POSTHOG_LOGS_LEVEL?.trim().toLowerCase();
  return {
    endpoint: env.POSTHOG_LOGS_ENDPOINT?.trim() || DEFAULT_LOGS_ENDPOINT,
    token,
    // Anything but an explicit "info" stays at the cheap default.
    minLevel: level === "info" ? "info" : "warn",
    environment: env.NODE_ENV ?? "unknown",
  };
}

export function levelPasses(level: LogLevel, min: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[min];
}

export type WindowBudget = { windowStart: number; used: number };

/** Pure fixed-window limiter: returns the next state and whether to send. */
export function takeSlot(
  state: WindowBudget,
  now: number,
): { state: WindowBudget; allowed: boolean } {
  const fresh = now - state.windowStart >= WINDOW_MS;
  const base = fresh ? { windowStart: now, used: 0 } : state;
  if (base.used >= MAX_LOGS_PER_WINDOW) return { state: base, allowed: false };
  return { state: { ...base, used: base.used + 1 }, allowed: true };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// JWTs and long opaque secrets (API keys, session tokens, hex ids).
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Pure: strip the PII-shaped substrings error text tends to carry, then cap. */
export function scrubMessage(message: string): string {
  return message
    .replace(EMAIL, "[email]")
    .replace(JWT, "[token]")
    .replace(OPAQUE, "[token]")
    .slice(0, MAX_MESSAGE_CHARS);
}

export type LogAttrs = Readonly<Record<string, string | number | boolean | undefined>>;

function otlpValue(value: string | number | boolean) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function otlpAttributes(attrs: LogAttrs) {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

/** Pure: the OTLP/JSON body for one log record. */
export function buildOtlpPayload(
  config: Pick<LogsConfig, "environment">,
  level: LogLevel,
  body: string,
  attrs: LogAttrs,
  nowMs: number,
) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: otlpAttributes({
            "service.name": SERVICE_NAME,
            "deployment.environment": config.environment,
          }),
        },
        scopeLogs: [
          {
            scope: { name: SERVICE_NAME },
            logRecords: [
              {
                timeUnixNano: `${nowMs}000000`,
                severityNumber: SEVERITY[level],
                severityText: level.toUpperCase(),
                body: { stringValue: body },
                attributes: otlpAttributes(attrs),
              },
            ],
          },
        ],
      },
    ],
  };
}

let budget: WindowBudget = { windowStart: 0, used: 0 };

/**
 * Thin I/O, fire-and-forget: logging must never fail or delay the request it
 * describes. Returns void and never throws.
 */
export function logServer(level: LogLevel, body: string, attrs: LogAttrs = {}): void {
  // Literal `process.env.X` reads, not the `process.env` object: Next inlines
  // NEXT_PUBLIC_* at build time only for literal accesses, and the runtime
  // container env need not carry it.
  const config = resolveLogsConfig({
    POSTHOG_LOGS_ENABLED: process.env.POSTHOG_LOGS_ENABLED,
    POSTHOG_LOGS_ENDPOINT: process.env.POSTHOG_LOGS_ENDPOINT,
    POSTHOG_LOGS_LEVEL: process.env.POSTHOG_LOGS_LEVEL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!config || !levelPasses(level, config.minLevel)) return;

  const now = Date.now();
  const slot = takeSlot(budget, now);
  budget = slot.state;
  if (!slot.allowed) return;

  fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(buildOtlpPayload(config, level, body, attrs, now)),
  }).catch(() => {
    // A dead logs endpoint must never surface as a failure of the request.
  });
}

export type RequestErrorContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
};

/**
 * Pure: the log record for a Next.js `onRequestError` call. Uses the ROUTE
 * PATTERN (`/unsubscribe/[token]`), never `request.path`, which carries the
 * real dynamic segments and query string (tokens, ids, emails).
 */
export function requestErrorRecord(
  error: unknown,
  request: Readonly<{ method: string }>,
  context: Readonly<RequestErrorContext>,
): { body: string; attrs: LogAttrs } {
  const err = error instanceof Error ? error : undefined;
  const digest = (error as { digest?: unknown } | null)?.digest;
  return {
    body: `${context.routeType} error on ${request.method} ${context.routePath}`,
    attrs: {
      "http.request.method": request.method,
      "http.route": context.routePath,
      "next.route_type": context.routeType,
      "next.router_kind": context.routerKind,
      "error.type": err?.name ?? typeof error,
      "error.message": scrubMessage(err?.message ?? String(error)),
      "error.digest": typeof digest === "string" ? digest : undefined,
    },
  };
}

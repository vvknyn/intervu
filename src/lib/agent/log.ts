/**
 * Structured stdout logging for the agent/MCP guardrails — rate-limit.ts's
 * hourly call limiter and record-budget.ts's daily record budget. The one
 * seam both route their log lines through, so the two subsystems can never
 * drift into different line shapes and a credential id/bearer token is
 * never truncated (or, worse, logged in full) at more than one call site.
 */

/** First 8 chars of a credential id (or an IP-derived rate-limit key, for
 *  the two public OAuth routes) — enough to correlate log lines for the
 *  same caller across a session without ever writing a full credential id
 *  or bearer token to stdout. */
export function truncateCredential(credentialId: string): string {
    return credentialId.slice(0, 8);
}

/** One `console.log` call site for every agent-guardrail log line. `tag`
 *  names the subsystem (`agent-rate-limit`, `agent-record-budget`); `event`
 *  is the outcome (`ok`, `REJECT`, `EXHAUSTED`); `fields` renders as
 *  space-separated `key=value` pairs in the order given. */
export function logAgentLimit(tag: string, event: string, fields: Record<string, string | number>): void {
    const rendered = Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
    console.log(`[${tag}] ${event} ${rendered}`);
}

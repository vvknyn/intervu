/**
 * Gets the pre-flight form audit without the `browser evaluate --fn` CLI
 * the skill used to shell out to (see form-audit.js's own header for that
 * CONTRACT). Exists so viewer.mjs's `--audit` mode can run the audit as a
 * side effect of starting the viewer — a step the agent cannot skip is a
 * step the agent cannot silently forget, unlike a prose instruction.
 *
 * Kept out of viewer.mjs (which owns the real WebSocket) so this is
 * testable without a browser — same split as cdp-targets.mjs / frame-pump.mjs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FORM_AUDIT_SOURCE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "form-audit.js"),
    "utf8",
);

/**
 * form-audit.js's own CONTRACT is to be passed as `--fn "$(cat
 * form-audit.js)"` to a CLI that wraps + invokes it. There's no such CLI
 * here, so this reproduces the wrap directly: the file's source is
 * comments followed by a bare `() => {...}` expression, so parenthesizing
 * the whole thing turns it into a callable, and the trailing `()` calls it.
 */
export function formAuditExpression(source = FORM_AUDIT_SOURCE) {
    return `(${source})()`;
}

/**
 * `evaluate` is one CDP Runtime.evaluate round-trip: expression in, the
 * page's return value out (or a rejection on a page-side exception).
 * Injected so this is testable without a browser — viewer.mjs supplies the
 * real, WebSocket-backed one.
 */
export async function runFormAudit(evaluate) {
    return evaluate(formAuditExpression());
}

/**
 * Runs the audit and prints it FIRST, then hands off to `startWatch`
 * (transports + WATCH lines) regardless of whether the audit succeeded.
 * Ordering is the whole point: the audit must reach stdout even when
 * startWatch later rejects (no LAN address, a dead WebRTC credential) or
 * the page-side eval itself throws — watching is a convenience, the audit
 * is the one thing FORM FILL cannot proceed without, so a failure on
 * either side must never suppress or delay the other.
 */
export async function auditThenWatch(evaluate, startWatch, log = console.log) {
    try {
        const audit = await runFormAudit(evaluate);
        log(`AUDIT: ${audit}`);
    } catch (error) {
        console.error(`Form audit failed: ${error.message}`);
    }
    return startWatch();
}

/**
 * The same best-first ladder SKILL.md already documents for the WATCH-*
 * lines: WATCH-ANYWHERE (verified tailnet) beats WATCH (doorbell) beats
 * WATCH-LAN (same WiFi). One source of truth so the SEND-TO-USER line can
 * never pick a different "best" link than the one a human reading the
 * WATCH-* output would.
 */
export function pickBestWatchUrl({ tailnetUrl, tailnetIsReady, watchUrl, lanUrl }) {
    if (tailnetUrl && tailnetIsReady) return tailnetUrl;
    if (watchUrl) return watchUrl;
    return lanUrl ?? null;
}

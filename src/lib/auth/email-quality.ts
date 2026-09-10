/**
 * Signup email quality gate: catches malformed syntax, disposable-provider
 * addresses, and domains with no mail-accepting host, before an account is
 * created under an address nobody can ever reach.
 *
 * Two seams, one cheap and one networked:
 *  - `screenSignupEmail` is the synchronous part (syntax + disposable-domain
 *    lookup via `mailchecker`) — no I/O, so it can run inline wherever an
 *    email needs a cheap sanity check (`validateSignupEmail` in
 *    username-email.ts, and the OAuth observe-only hook in provisioning.ts).
 *  - `assessSignupEmail` adds the DNS deliverability check on top, with the
 *    resolver injected via `deps` so tests exercise the decision against
 *    fakes rather than a real DNS server; `realEmailQualityDeps` wires
 *    `node:dns/promises` for production.
 *
 * Fail-open is deliberate: a DNS timeout or resolver error (ESERVFAIL,
 * EREFUSED, our own resolver having a bad day) must never block a real
 * signup — only a domain that plainly answers "no MX, no A/AAAA either", or
 * one that publishes an RFC 7505 null MX ("this domain accepts no mail"),
 * is rejected. Rejections are the only closed outcomes; everything else is
 * a logged warning and `{ ok: true }`.
 *
 * `timeoutMs` bounds the ENTIRE call, not each lookup independently: the
 * deadline is computed once from the start of `assessSignupEmail`, and the
 * A/AAAA fallback (when the MX lookup answers quickly with "no records")
 * gets whatever's left of that budget rather than a fresh `timeoutMs` of
 * its own — otherwise a domain with slow-but-answering DNS could burn close
 * to 2×`timeoutMs` in one request.
 */
import MailChecker from "mailchecker";
import { resolveMx as dnsResolveMx, resolve4, resolve6 } from "node:dns/promises";

export type EmailQualityReason = "syntax" | "disposable" | "no_mail_host";

export type EmailVerdict = { ok: true } | { ok: false; reason: EmailQualityReason };

export interface EmailQualityDeps {
    resolveMx(domain: string): Promise<{ exchange: string }[]>;
    resolveAddress(domain: string): Promise<string[]>;
    timeoutMs?: number;
}

/** Single source of truth for the copy shown to a rejected signer-upper —
 *  every caller (password path, and any future one) reads the same strings. */
export const EMAIL_QUALITY_MESSAGES: Record<EmailQualityReason, string> = {
    syntax: "That doesn't look like a valid email address.",
    disposable: "Disposable email addresses aren't accepted — use an address you'll keep.",
    no_mail_host: "That email domain can't receive mail. Check the spelling.",
};

const DEFAULT_TIMEOUT_MS = 2500;

// A domain needs at least one dot and a final label of 2+ letters. Applied
// only after the `@`-split below, so it never has to account for the local
// part's own, much looser, character set.
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

// RFC 5322 dot-atom "atext" charset for the local part — excludes spaces,
// control characters, and the quoted-string punctuation mailchecker's own
// regex also rejects. This is the single authority for "syntax" so that
// syntax can never come back reported as "disposable" (see screenSignupEmail
// below): an input that fails this can't reach the disposable check at all.
const LOCAL_ATEXT_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/** `null` means "no complaint" — deliberately not a boolean, so callers never
 *  have to remember which way a `screenSignupEmail(...)` truthiness reads. */
export function screenSignupEmail(email: string): "syntax" | "disposable" | null {
    if (!hasValidSyntax(email)) return "syntax";
    const domain = emailDomain(email) as string; // hasValidSyntax above guarantees an "@"
    if (isDisposableDomain(domain)) return "disposable";
    return null;
}

function hasValidSyntax(email: string): boolean {
    if (email.length === 0 || email.length > 254) return false;
    const parts = email.split("@");
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (local.length < 1 || local.length > 64) return false;
    if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
    if (!LOCAL_ATEXT_RE.test(local)) return false;
    if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
    return DOMAIN_RE.test(domain);
}

/** Disposable-domain lookup against mailchecker's own blacklist Set —
 *  deliberately NOT `MailChecker.isValid()`, which also re-runs mailchecker's
 *  own (stricter) syntax regex and reports both defects as "not valid". That
 *  conflation is exactly what let a syntax defect (e.g. a stray space in the
 *  local part) come back mislabeled as "disposable" for a domain that was
 *  never on the list. Walks up the labels the same way mailchecker's
 *  internal `isBlacklisted` does, so `foo.mailinator.com` still matches via
 *  `mailinator.com`. */
function isDisposableDomain(domain: string): boolean {
    const blacklist = MailChecker.blacklist();
    let current = domain.toLowerCase();
    for (;;) {
        if (blacklist.has(current)) return true;
        const dot = current.indexOf(".");
        if (dot === -1) return false;
        current = current.slice(dot + 1);
    }
}

/** `null` when the address has no `@` at all — a caller logging this
 *  alongside a rejection reason should not have to special-case that. */
export function emailDomain(email: string): string | null {
    const at = email.lastIndexOf("@");
    return at === -1 ? null : email.slice(at + 1);
}

/**
 * The full signup-email decision: syntax, then disposable, then — the only
 * networked step — can this domain actually receive mail. Standalone and
 * self-contained (re-running the sync screen costs a couple of regex tests
 * and a Set lookup) so it is usable, and testable, on its own rather than
 * only as a tail call after `validateSignupEmail`.
 */
export async function assessSignupEmail(email: string, deps: EmailQualityDeps): Promise<EmailVerdict> {
    const syncReason = screenSignupEmail(email);
    if (syncReason) return { ok: false, reason: syncReason };

    const domain = emailDomain(email) as string; // syntax check above guarantees an "@"
    // One deadline for the whole call (see module doc) — every lookup below
    // draws down the SAME budget instead of getting a fresh `timeoutMs`.
    const deadline = Date.now() + (deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
        const mx = await withTimeout(deps.resolveMx(domain), remainingMs(deadline));
        if (mx.length > 0) {
            // RFC 7505: a single MX RR whose exchange is "." is a domain
            // affirmatively declaring it accepts no mail at all — not the
            // same as "no MX record" (which still gets the A/AAAA fallback).
            if (isNullMx(mx)) return { ok: false, reason: "no_mail_host" };
            return { ok: true };
        }
        // Resolved cleanly but published no MX record — RFC 5321 fallback.
        return await checkAddressFallback(domain, deps, remainingMs(deadline));
    } catch (error) {
        if (isNoRecordsError(error)) {
            return await checkAddressFallback(domain, deps, remainingMs(deadline));
        }
        console.warn("[email-quality] MX lookup failed open", { domain, error: describeError(error) });
        return { ok: true };
    }
}

function isNullMx(mx: { exchange: string }[]): boolean {
    return mx.every((record) => record.exchange === ".");
}

async function checkAddressFallback(domain: string, deps: EmailQualityDeps, remainingMs: number): Promise<EmailVerdict> {
    try {
        const addresses = await withTimeout(deps.resolveAddress(domain), remainingMs);
        return addresses.length > 0 ? { ok: true } : { ok: false, reason: "no_mail_host" };
    } catch (error) {
        if (isNoRecordsError(error)) {
            return { ok: false, reason: "no_mail_host" };
        }
        console.warn("[email-quality] A/AAAA lookup failed open", { domain, error: describeError(error) });
        return { ok: true };
    }
}

function isNoRecordsError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === "ENODATA" || code === "ENOTFOUND";
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function remainingMs(deadline: number): number {
    return Math.max(0, deadline - Date.now());
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    // No budget left: fail open exactly like a real timeout would, rather
    // than racing a `setTimeout(fn, 0)` against a promise that might settle
    // synchronously first.
    if (ms <= 0) {
        return Promise.reject(Object.assign(new Error("email-quality DNS lookup timed out (no budget remaining)"), { code: "ETIMEDOUT" }));
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(Object.assign(new Error(`email-quality DNS lookup timed out after ${ms}ms`), { code: "ETIMEDOUT" }));
        }, ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

async function resolveAddressReal(domain: string): Promise<string[]> {
    const [v4, v6] = await Promise.allSettled([resolve4(domain), resolve6(domain)]);
    const addresses = [v4, v6].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (addresses.length > 0) return addresses;
    // Both empty: surface a hard (non-nodata) failure so the caller's
    // fail-open catch handles it — only a clean double-empty means "this
    // domain truly has no A/AAAA".
    const hardFailure = [v4, v6].find(
        (r): r is PromiseRejectedResult => r.status === "rejected" && !isNoRecordsError(r.reason),
    );
    if (hardFailure) throw hardFailure.reason;
    return [];
}

/** Real deps: `node:dns/promises` directly — no dynamic import needed, this
 *  is a builtin, not one of the ESM-only SDKs the rest of this directory
 *  works around. */
export const realEmailQualityDeps: EmailQualityDeps = {
    resolveMx: dnsResolveMx,
    resolveAddress: resolveAddressReal,
};

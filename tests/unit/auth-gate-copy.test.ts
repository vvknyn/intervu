import { test } from "node:test";
import assert from "node:assert/strict";
import {
    AUTH_CTA_LABEL,
    authCardCopy,
    authGateCopy,
    formatAuthGateValueLine,
    guestKeepLine,
    SIGNUP_SUBCOPY,
    RESUME_UPLOAD_CTA,
    type AuthGateReason,
} from "../../src/lib/auth/auth-gate-copy";
import { SIGNUP_GATE_ID_BY_REASON } from "../../src/lib/auth/gate-attempt";
import { RESUME_LOCAL_DEVICE_BANNER } from "../../src/lib/privacy-modes";

/** Every reason the app emits (gate-attempt.ts keys one row per `AuthGateReason`). */
const REASONS = Object.keys(SIGNUP_GATE_ID_BY_REASON) as AuthGateReason[];

test("guestKeepLine is null for zero count", () => {
    assert.equal(guestKeepLine(0), null);
});

test("authGateCopy: every reason has a title and ONE sentence line, with no copy shared between reasons", () => {
    assert.equal(REASONS.length, 13);
    const seen = new Set<string>();
    for (const reason of REASONS) {
        const { title, line } = authGateCopy(reason);
        assert.ok(title.length > 0, `${reason} title`);
        assert.match(line, /^[^.!?]+(\.|: [^.!?]+\.)?$/, `${reason} line is one sentence: ${line}`);
        for (const text of [title, line]) {
            assert.ok(!seen.has(text), `${reason} repeats "${text}"`);
            seen.add(text);
        }
    }
});

test("fit and résumé lines are true before and after an upload and keep the privacy promise", () => {
    for (const reason of ["fit", "resume", "packs"] as const) {
        const { title, line } = authGateCopy(reason);
        assert.doesNotMatch(title, /then upload/i);
        assert.doesNotMatch(line, /We read your résumé/i);
        assert.match(line, /on this device/, `${reason} says where the résumé stays`);
        assert.doesNotMatch(line, /encrypted|keeps (the|its) structured/i, `${reason} must not promise account storage`);
    }
});

test("tailor gate says tailoring is paid, not free, and never promises a synced résumé", () => {
    const { title, line } = authGateCopy("tailor");
    assert.match(line, /paid month/);
    assert.doesNotMatch(`${title} ${line}`, /free account|syncs/i);
});

test("formatAuthGateValueLine prefixes the saved-role line and keeps the reason's line", () => {
    for (const reason of ["save", "alert", "company"] as const) {
        const { line } = authGateCopy(reason);
        assert.equal(formatAuthGateValueLine(reason, 0), line);
        assert.equal(formatAuthGateValueLine(reason, 2), `We'll keep the 2 roles you've saved on this device. ${line}`);
    }
});

test("résumé-step banner says where the file and the structured résumé are kept", () => {
    assert.equal(
        RESUME_LOCAL_DEVICE_BANNER,
        "Local · Free. Your résumé is read in your browser and stays on this device. The file is never uploaded. To find jobs we send the search only: job titles or top skills, country and seniority. Searches built from your résumé aren't logged, and analytics never include your résumé or how you match a job.",
    );
});

test("resume upload CTA names the importer — uploading needs no account", () => {
    assert.equal(RESUME_UPLOAD_CTA, "Upload résumé");
});

test("authCardCopy: tab label, title, and submit label are identical per tab", () => {
    const login = authCardCopy("login");
    assert.equal(login.tabLabel, login.title);
    assert.equal(login.title, AUTH_CTA_LABEL);
    const signup = authCardCopy("signup");
    assert.equal(signup.title, "Create account");
});

test("SIGNUP_SUBCOPY names the alerts/saved-search/tracker value triad", () => {
    assert.match(SIGNUP_SUBCOPY, /alert/i);
    assert.match(SIGNUP_SUBCOPY, /saved search/i);
    assert.match(SIGNUP_SUBCOPY, /tracker/i);
});

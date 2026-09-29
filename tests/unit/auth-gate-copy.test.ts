import { test } from "node:test";
import assert from "node:assert/strict";
import {
    AUTH_CTA_LABEL,
    AUTH_GATE_RESUME_ACCOUNT_LINE,
    authCardCopy,
    authGateTitle,
    formatAuthGateValueLine,
    guestKeepLine,
    SIGNUP_SUBCOPY,
    RESUME_UPLOAD_CTA,
} from "../../src/lib/auth/auth-gate-copy";
import { RESUME_LOCAL_DEVICE_BANNER } from "../../src/lib/jobs/resume-privacy-copy";
test("guestKeepLine is null for zero count", () => {
    assert.equal(guestKeepLine(0), null);
});

test("formatAuthGateValueLine for save mentions tracker sync", () => {
    const line = formatAuthGateValueLine("save", 0);
    assert.match(line, /sync across devices/i);
});

test('fit gate has title and body from copy matrix', () => {
    assert.equal(authGateTitle("fit"), "Create your free account, then upload your résumé.");
    assert.match(formatAuthGateValueLine("fit", 0), /personalized job picks/i);
    assert.match(formatAuthGateValueLine("fit", 0), /Strong\/Good\/Stretch/i);
});

test("fit and résumé sign-in cards add the account line under the unlock line", () => {
    for (const reason of ["fit", "resume"] as const) {
        const line = formatAuthGateValueLine(reason, 0);
        const unlockAt = line.indexOf("personalized job picks");
        const accountAt = line.indexOf(AUTH_GATE_RESUME_ACCOUNT_LINE);
        assert.ok(unlockAt >= 0, reason);
        assert.ok(accountAt > unlockAt, reason);
        assert.match(line, /structured version with your account, not the original file/);
    }
    assert.equal(
        formatAuthGateValueLine("save", 0).includes(AUTH_GATE_RESUME_ACCOUNT_LINE),
        false,
    );
});

test("résumé-step banner stays the existing device-parse line", () => {
    assert.equal(
        RESUME_LOCAL_DEVICE_BANNER,
        "Parsed on this device. The file and structured result stay in this browser until you create an account and sync. When you search jobs, our servers may send role and skill phrases derived from your résumé to our search index—not your full résumé file.",
    );
});

test('save gate has title from copy matrix', () => {
    assert.equal(authGateTitle("save"), "Sign in to save this job to Tracker.");
});

test('generic and topbar use tracker sync copy', () => {
    assert.match(formatAuthGateValueLine("generic", 0), /sync your tracker across devices/i);
    assert.match(formatAuthGateValueLine("topbar", 0), /sync your tracker across devices/i);
});

test("tailor gate mentions sync, not auth wall before customize", () => {
    assert.match(formatAuthGateValueLine("tailor", 0), /sync/i);
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

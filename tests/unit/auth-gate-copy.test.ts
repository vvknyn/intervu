import { test } from "node:test";
import assert from "node:assert/strict";
import {
    AUTH_CTA_LABEL,
    authCardCopy,
    authGateTitle,
    formatAuthGateValueLine,
    guestKeepLine,
    SIGNUP_SUBCOPY,
    RESUME_UPLOAD_CTA,
    RESUME_UPLOAD_AUTH_CTA,
} from "../../src/lib/auth/auth-gate-copy";
test("guestKeepLine is null for zero count", () => {
    assert.equal(guestKeepLine(0), null);
});

test("formatAuthGateValueLine for save mentions tracker sync", () => {
    const line = formatAuthGateValueLine("save", 0);
    assert.match(line, /sync across devices/i);
});

test('fit gate has title and body from copy matrix', () => {
    assert.equal(authGateTitle("fit"), "Create your free account, then upload your résumé.");
    assert.match(formatAuthGateValueLine("fit", 0), /For you, Strong\/Good\/Stretch/i);
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

test("resume upload CTA labels distinguish auth-next vs importer-next", () => {
    assert.equal(RESUME_UPLOAD_CTA, "Upload résumé");
    assert.equal(RESUME_UPLOAD_AUTH_CTA, "Create account & upload résumé");
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

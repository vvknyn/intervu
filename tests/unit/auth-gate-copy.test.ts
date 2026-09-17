import { test } from "node:test";
import assert from "node:assert/strict";
import {
    authCardCopy,
    formatAuthGateValueLine,
    guestKeepLine,
    SIGNUP_SUBCOPY,
} from "../../src/lib/auth/auth-gate-copy";

test("guestKeepLine is null for zero count", () => {
    assert.equal(guestKeepLine(0), null);
});

test("guestKeepLine uses singular copy for one pursuit", () => {
    assert.match(guestKeepLine(1)!, /role you've saved/);
});

test("guestKeepLine uses plural copy for multiple pursuits", () => {
    assert.match(guestKeepLine(3)!, /3 roles/);
});

test("formatAuthGateValueLine varies by reason class", () => {
    assert.match(formatAuthGateValueLine("apply", 0), /track this application/i);
    assert.match(formatAuthGateValueLine("generic", 0), /sync/);
});

test('formatAuthGateValueLine for reason "save" mentions keep-across-devices and alerts', () => {
    const line = formatAuthGateValueLine("save", 0);
    assert.match(line, /across devices/i);
    assert.match(line, /alert/i);
});

test('formatAuthGateValueLine for reason "fit" mentions matching roles to résumé', () => {
    const line = formatAuthGateValueLine("fit", 0);
    assert.match(line, /match roles to your résumé/i);
    assert.match(line, /recommendations/i);
});

// Facts only (verified true from src/lib/match/score.ts and
// src/lib/local-ai/tailor-with-engine.ts, both client-side modules) — not a
// claim about the résumé file itself, which is extracted server-side.
test('formatAuthGateValueLine for reason "fit" states scoring/tailoring run in the browser', () => {
    assert.match(formatAuthGateValueLine("fit", 0), /Fit scoring and tailoring run in your browser\./);
});

test('formatAuthGateValueLine for reason "report" mentions reporting issue', () => {
    const line = formatAuthGateValueLine("report", 0);
    assert.match(line, /report an issue/i);
});

test('formatAuthGateValueLine for reason "tailor" mentions on-device AI and export', () => {
    const line = formatAuthGateValueLine("tailor", 0);
    assert.match(line, /on-device AI/i);
    assert.match(line, /export/i);
});

test('formatAuthGateValueLine for reason "resume" mentions edit, export, and sync', () => {
    const line = formatAuthGateValueLine("resume", 0);
    assert.match(line, /edit, export, and sync/i);
});

test("formatAuthGateValueLine prepends keep-line only when count is real", () => {
    assert.doesNotMatch(formatAuthGateValueLine("generic", 0), /keep/i);
    assert.match(formatAuthGateValueLine("generic", 2), /keep the 2 roles/);
});

// Wave-2 signup-ladder audit (2026-08-20): the header's new "Get job
// alerts" CTA opens straight to the signup tab, whose only value pitch is
// this subcopy — it has to actually name the alerts/tracker promise the
// button just made, not a generic "save roles" line.
test("SIGNUP_SUBCOPY names the alerts/saved-search/tracker value triad", () => {
    assert.match(SIGNUP_SUBCOPY, /alert/i);
    assert.match(SIGNUP_SUBCOPY, /saved search/i);
    assert.match(SIGNUP_SUBCOPY, /tracker/i);
});

// Redesign (2026-08-27, frozen proposal #9): the login card's tab, heading,
// and submit button must literally share one word per action — this is the
// "control-names-the-action" invariant, proved by construction rather than
// by convention.
test("authCardCopy: tab label, title, and submit label are identical per tab", () => {
    const login = authCardCopy("login");
    assert.equal(login.tabLabel, login.title);
    assert.equal(login.tabLabel, login.submitLabel);
    assert.equal(login.title, "Sign in");

    const signup = authCardCopy("signup");
    assert.equal(signup.tabLabel, signup.title);
    assert.equal(signup.tabLabel, signup.submitLabel);
    assert.equal(signup.title, "Create account");
});

test("authCardCopy: login and signup never share the same wording", () => {
    assert.notEqual(authCardCopy("login").title, authCardCopy("signup").title);
});

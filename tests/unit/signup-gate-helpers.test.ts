import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveHiddenCount, type CorpusCount } from "../../src/lib/jobs/corpus-count";
import { signupGateCopy } from "../../src/lib/auth/auth-gate-copy";
import { signupGateHrefs } from "../../src/lib/auth/post-auth-destination";
import { decideSaveAttempt } from "../../src/lib/auth/guest-save-gate";
import { SIGNUP_GATE_ID_BY_REASON, gateAttemptEventFields } from "../../src/lib/auth/gate-attempt";
import { FIT_GUEST_PREVIEW_ROWS, splitFitGate } from "../../src/lib/jobs/fit-gate";
import { resolveReporterKey } from "../../src/lib/jobs/reporter-key";
import {
    REPORT_LISTING_MAX_REQUESTS,
    allowReportListingRequest,
    clearRateLimitStateForTests,
} from "../../src/lib/shield/rate-limit";
import { UNKNOWN_CLIENT_IP } from "../../src/lib/shield/client-ip";
import { VISIT_BANNER_MIN_RESULTS, visitBannerFitsResults } from "../../src/lib/jobs/visit-banner";

const exact = (value: number): CorpusCount => ({ kind: "exact", value });
const floor = (value: number): CorpusCount => ({ kind: "floor", value });

test("resolveHiddenCount: exact stays exact, floor stays floor, nothing hidden is null", () => {
    assert.deepEqual(resolveHiddenCount(exact(351), 90), exact(261));
    assert.deepEqual(resolveHiddenCount(floor(10000), 90), floor(9910));
    assert.equal(resolveHiddenCount(exact(90), 90), null);
    assert.equal(resolveHiddenCount(exact(40), 90), null);
    assert.equal(resolveHiddenCount(exact(0), 0), null);
});

test("signupGateCopy: quotes a true count (floor as N+), never fabricates one", () => {
    assert.equal(signupGateCopy("depth", exact(261)).title, "See the other 261 roles that match");
    assert.match(signupGateCopy("depth", floor(9910)).title, /9,?910\+/);
    assert.equal(signupGateCopy("depth", null).title, "See every result");
    assert.equal(signupGateCopy("fit", exact(84)).title, "See all 84 matches ranked for you");
    assert.equal(signupGateCopy("fit").title, "See all your ranked matches");
    // A reason with no count variant ignores a count instead of printing it.
    assert.equal(signupGateCopy("alert", exact(5)).title, "Save this search");
    for (const reason of Object.keys(SIGNUP_GATE_ID_BY_REASON) as Array<keyof typeof SIGNUP_GATE_ID_BY_REASON>) {
        const copy = signupGateCopy(reason);
        assert.ok(copy.title.length > 0 && copy.body.length > 0, `${reason} has copy`);
        assert.equal(copy.createLabel, "Create free account");
    }
});

test("signupGateHrefs: create is signup-mode /auth/start, sign in is /login, both carry the page", () => {
    const { create, signIn } = signupGateHrefs("/jobs?q=data engineer&page=3");
    assert.equal(create, "/auth/start?mode=signup&next=%2Fjobs%3Fq%3Ddata%20engineer%26page%3D3");
    assert.equal(signIn, "/login?next=%2Fjobs%3Fq%3Ddata%20engineer%26page%3D3");
    assert.equal(signupGateHrefs("/companies/acme").signIn, "/login?next=%2Fcompanies%2Facme");
    // A bare query string is not a return path (the saved-search gate once passed one): tsc rejects it.
    // @ts-expect-error — `?q=engineer` has no path
    signupGateHrefs("?q=engineer");
});

function withLocalStorage(run: () => void) {
    const data = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = {
        localStorage: {
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => void data.set(k, v),
        },
    };
    try {
        run();
    } finally {
        g.window = prev;
    }
}

test("decideSaveAttempt: a guest's save is gated first or later, whatever an old counter holds; signed in saves", () => {
    for (const stored of [undefined, "0", "1", "5"]) {
        withLocalStorage(() => {
            const ls = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
            if (stored !== undefined) ls.setItem("intervu.guestSaveCount", stored);
            assert.equal(decideSaveAttempt(false), "gate");
        });
    }
    assert.equal(decideSaveAttempt(true), "save");
});

test("gate id: every reason maps, and signup_completed fields carry the last reason's gate", () => {
    assert.equal(SIGNUP_GATE_ID_BY_REASON.fit, "resume_fit");
    assert.equal(SIGNUP_GATE_ID_BY_REASON.follow, "follow");
    assert.equal(SIGNUP_GATE_ID_BY_REASON.topbar, "header");
    const fields = gateAttemptEventFields({
        firstGateReason: "fit",
        lastGateReason: "depth",
        pendingActionId: "p1",
        originSurface: "jobs_banner",
    } as Parameters<typeof gateAttemptEventFields>[0]);
    assert.equal(fields.gate, "depth");
    assert.equal(fields.first_gate_reason, "fit");
    assert.deepEqual(gateAttemptEventFields(null), {});
});

test("splitFitGate: guest gets the top 3 and a true count; other cases are never gated", () => {
    const rows = [1, 2, 3, 4, 5, 6];
    const base = { fitActive: true, ranked: true, signedOut: true, rows, total: exact(84) };
    const g = splitFitGate(base);
    assert.equal(g.gated, true);
    assert.deepEqual(g.visible, [1, 2, 3]);
    assert.equal(FIT_GUEST_PREVIEW_ROWS, 3);
    assert.deepEqual(g.count, exact(84));
    // signed in, fit off, or not yet ranked: the whole list, no gate.
    for (const off of [{ signedOut: false }, { fitActive: false }, { ranked: false }]) {
        const s = splitFitGate({ ...base, ...off });
        assert.equal(s.gated, false);
        assert.deepEqual(s.visible, rows);
        assert.equal(s.count, null);
    }
    // A list that fits in the preview has nothing to unlock.
    assert.equal(splitFitGate({ ...base, rows: [1, 2, 3], total: exact(3) }).gated, false);
    // More loaded than previewed but a zero total: gated, but no fabricated count.
    assert.equal(splitFitGate({ ...base, total: exact(0) }).count, null);
});

test("resolveReporterKey: uid wins; anon key is stable per IP, distinct across IPs, never the raw IP; unknown IP refuses", () => {
    assert.equal(resolveReporterKey("user-1", "1.2.3.4", "s"), "user-1");
    const a = resolveReporterKey(null, "1.2.3.4", "secret");
    assert.match(a ?? "", /^anon:[0-9a-f]{32}$/);
    assert.equal(a, resolveReporterKey(null, "1.2.3.4", "secret"));
    assert.notEqual(a, resolveReporterKey(null, "5.6.7.8", "secret"));
    assert.notEqual(a, resolveReporterKey(null, "1.2.3.4", "other-secret"));
    assert.ok(!(a ?? "").includes("1.2.3.4"));
    assert.equal(resolveReporterKey(null, UNKNOWN_CLIENT_IP, "secret"), null);
    // A signed-in user is never blocked by an unknown IP.
    assert.equal(resolveReporterKey("user-1", UNKNOWN_CLIENT_IP, "secret"), "user-1");
});

test("allowReportListingRequest: budget per IP, another IP unaffected", () => {
    clearRateLimitStateForTests();
    const now = 1_000_000;
    for (let i = 0; i < REPORT_LISTING_MAX_REQUESTS; i++) assert.equal(allowReportListingRequest("9.9.9.9", now + i), true);
    assert.equal(allowReportListingRequest("9.9.9.9", now + 10), false);
    assert.equal(allowReportListingRequest("8.8.8.8", now + 10), true);
    clearRateLimitStateForTests();
});

test("visitBannerFitsResults: thin and empty result sets never carry the banner", () => {
    assert.equal(visitBannerFitsResults(0), false);
    assert.equal(visitBannerFitsResults(VISIT_BANNER_MIN_RESULTS - 1), false);
    assert.equal(visitBannerFitsResults(VISIT_BANNER_MIN_RESULTS), true);
    assert.equal(visitBannerFitsResults(90), true);
});

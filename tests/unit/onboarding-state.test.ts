import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    answeredCount,
    applyOnboardingPatch,
    doneCount,
    firstOpenStep,
    localDay,
    newOnboardingRecord,
    parseOnboardingRecord,
    setupOpen,
    stepOutcomes,
    stripDecision,
    type OnboardingRecord,
    type SetupFacts,
} from "../../src/lib/onboarding/state";

const NOTHING: SetupFacts = { resumeOnFile: false, roles: null, location: null, remoteOnly: false, savedSearches: 0 };
const fresh = (): OnboardingRecord => newOnboardingRecord("2026-10-05T17:00:00.000Z");

describe("parseOnboardingRecord", () => {
    it("an account made before setup existed has none", () => {
        assert.equal(parseOnboardingRecord(undefined), null);
        assert.equal(parseOnboardingRecord({}), null);
        assert.equal(parseOnboardingRecord({ state: "weird" }), null);
    });

    it("keeps only known steps, real days, and at most three of them", () => {
        const parsed = parseOnboardingRecord({
            state: "open",
            started_at: "2026-10-05T17:00:00.000Z",
            steps: { resume: "done", place: "maybe", email: "skipped", extra: "done" },
            strip_days: ["2026-10-07", "2026-10-05", "nope", "2026-10-05", "2026-10-06", "2026-10-09"],
            hidden_day: 12,
        });
        assert.deepEqual(parsed, {
            state: "open",
            started_at: "2026-10-05T17:00:00.000Z",
            steps: { resume: "done", email: "skipped" },
            strip_days: ["2026-10-05", "2026-10-06", "2026-10-07"],
            hidden_day: null,
        });
    });
});

describe("stepOutcomes", () => {
    it("a new account with nothing on file has every step open", () => {
        const outcomes = stepOutcomes(fresh(), NOTHING);
        assert.deepEqual(outcomes, { resume: null, place: null, email: null });
        assert.equal(firstOpenStep(outcomes), "resume");
        assert.equal(setupOpen(fresh(), outcomes), true);
    });

    it("what the account already holds answers a step without asking again", () => {
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, resumeOnFile: true }).resume, "done");
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, roles: "Registered nurse" }).resume, "done");
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, location: "Lagos, Nigeria" }).place, "done");
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, remoteOnly: true }).place, "done");
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, savedSearches: 1 }).email, "done");
        assert.equal(stepOutcomes(fresh(), { ...NOTHING, roles: "   " }).resume, null);
    });

    it("the person's own answer wins, and every step answered closes setup", () => {
        const record = applyOnboardingPatch(
            applyOnboardingPatch(applyOnboardingPatch(fresh(), { step: { step: "resume", outcome: "skipped" } }), {
                step: { step: "place", outcome: "done" },
            }),
            { step: { step: "email", outcome: "skipped" } },
        );
        const outcomes = stepOutcomes(record, { ...NOTHING, resumeOnFile: true });
        assert.deepEqual(outcomes, { resume: "skipped", place: "done", email: "skipped" });
        assert.equal(answeredCount(outcomes), 3);
        assert.equal(doneCount(outcomes), 1);
        assert.equal(firstOpenStep(outcomes), null);
        assert.equal(setupOpen(record, outcomes), false);
    });
});

describe("stripDecision", () => {
    const open = (r: OnboardingRecord) => stepOutcomes(r, NOTHING);

    it("shows on the first day and two more visit days, then only the account menu offers setup", () => {
        let record = fresh();
        const days = ["2026-10-05", "2026-10-08", "2026-10-20"];
        days.forEach((day, i) => {
            const decision = stripDecision(record, open(record), day);
            assert.deepEqual(decision, { show: true, day: i + 1, recordDay: true });
            record = applyOnboardingPatch(record, { stripDay: day });
            // The same day again: still showing, nothing more to record.
            assert.deepEqual(stripDecision(record, open(record), day), { show: true, day: i + 1, recordDay: false });
        });
        assert.equal(stripDecision(record, open(record), "2026-10-21").show, false);
        assert.equal(setupOpen(record, open(record)), true);
        // A fourth day is never recorded.
        assert.deepEqual(applyOnboardingPatch(record, { stripDay: "2026-10-21" }).strip_days, days);
    });

    it("Later hides it for the rest of that day only", () => {
        const record = applyOnboardingPatch(applyOnboardingPatch(fresh(), { stripDay: "2026-10-05" }), { laterDay: "2026-10-05" });
        assert.equal(stripDecision(record, open(record), "2026-10-05").show, false);
        assert.deepEqual(stripDecision(record, open(record), "2026-10-06"), { show: true, day: 2, recordDay: true });
    });

    it("never shows for an account without setup, or once it is finished", () => {
        assert.equal(stripDecision(null, null, "2026-10-05").show, false);
        const finished = applyOnboardingPatch(fresh(), { finish: true });
        assert.equal(stripDecision(finished, open(finished), "2026-10-05").show, false);
    });
});

describe("applyOnboardingPatch", () => {
    it("ignores malformed days and steps", () => {
        const record = fresh();
        const next = applyOnboardingPatch(record, {
            stripDay: "yesterday",
            laterDay: "2026/10/05",
            step: { step: "salary" as never, outcome: "done" },
        });
        assert.deepEqual(next, record);
    });
});

describe("localDay", () => {
    it("is the reader's own calendar day", () => {
        assert.equal(localDay(new Date(2026, 9, 5, 23, 59)), "2026-10-05");
        assert.equal(localDay(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
    });
});

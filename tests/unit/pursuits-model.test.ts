import { test } from "node:test";
import assert from "node:assert/strict";
import {
    nextAction,
    orderPursuits,
    isEnded,
    mergeGuestPursuit,
    buildJobSnapshot,
    buildManualPursuitSnapshot,
    hasReachedStage,
    stageRank,
    stageLabel,
    PURSUIT_STAGES,
    type Pursuit,
    type PursuitStage,
} from "../../src/lib/pursuits/types";
import type { PublicJob } from "../../src/lib/jobs/types";

function makePursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    return {
        id: "p1",
        company_name: "Acme",
        position: "Engineer",
        status: "interested",
        user_id: "u1",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
        ...overrides,
    };
}

/* --------------------------------- nextAction --------------------------------- */

test("nextAction maps every stage to exactly one action kind", () => {
    const cases: Array<[PursuitStage, string]> = [
        ["interested", "tailor"],
        ["resume_ready", "apply"],
        ["applied", "set_interview"],
        ["interviewing", "prep"],
        ["offer", "closed"],
        ["rejected", "closed"],
        ["withdrawn", "closed"],
    ];
    for (const [status, kind] of cases) {
        const action = nextAction(makePursuit({ status }));
        assert.equal(action.kind, kind, `stage ${status} should map to ${kind}`);
        assert.ok(action.label.length > 0, `stage ${status} should have a non-empty label`);
    }
});

/* --------------------------------- isEnded --------------------------------- */

test("isEnded is true only for rejected/withdrawn", () => {
    for (const status of ["interested", "resume_ready", "applied", "interviewing", "offer"] as PursuitStage[]) {
        assert.equal(isEnded(makePursuit({ status })), false, status);
    }
    assert.equal(isEnded(makePursuit({ status: "rejected" })), true);
    assert.equal(isEnded(makePursuit({ status: "withdrawn" })), true);
});

/* --------------------------------- stageRank / hasReachedStage --------------------------------- */

test("stageRank is monotonically increasing across the union order", () => {
    const order: PursuitStage[] = [
        "interested",
        "resume_ready",
        "applied",
        "interviewing",
        "offer",
        "rejected",
        "withdrawn",
    ];
    for (let i = 1; i < order.length; i++) {
        assert.ok(stageRank(order[i]) > stageRank(order[i - 1]), `${order[i]} should rank above ${order[i - 1]}`);
    }
});

test("hasReachedStage compares by rank, not equality", () => {
    assert.equal(hasReachedStage(makePursuit({ status: "interviewing" }), "applied"), true);
    assert.equal(hasReachedStage(makePursuit({ status: "applied" }), "applied"), true);
    assert.equal(hasReachedStage(makePursuit({ status: "interested" }), "applied"), false);
});

/* --------------------------------- orderPursuits --------------------------------- */

test("orderPursuits puts interviewing pursuits first, soonest interview_date first", () => {
    const soon = makePursuit({ id: "soon", status: "interviewing", interview_date: "2026-08-01T00:00:00.000Z" });
    const later = makePursuit({ id: "later", status: "interviewing", interview_date: "2026-08-10T00:00:00.000Z" });
    const noDate = makePursuit({ id: "no-date", status: "interviewing" });
    const applied = makePursuit({ id: "applied", status: "applied", updated_at: "2026-07-15T00:00:00.000Z" });

    const ordered = orderPursuits([applied, later, noDate, soon]);
    assert.deepEqual(
        ordered.map((p) => p.id),
        ["soon", "later", "no-date", "applied"],
    );
});

test("orderPursuits sorts non-interviewing active pursuits by updated_at desc", () => {
    const old = makePursuit({ id: "old", status: "applied", updated_at: "2026-07-01T00:00:00.000Z" });
    const fresh = makePursuit({ id: "fresh", status: "interested", updated_at: "2026-07-20T00:00:00.000Z" });

    const ordered = orderPursuits([old, fresh]);
    assert.deepEqual(
        ordered.map((p) => p.id),
        ["fresh", "old"],
    );
});

test("orderPursuits pushes ended pursuits (rejected/withdrawn) to the bottom, most-recent-first", () => {
    const active = makePursuit({ id: "active", status: "applied", updated_at: "2026-07-01T00:00:00.000Z" });
    const rejectedOld = makePursuit({ id: "rejected-old", status: "rejected", updated_at: "2026-07-05T00:00:00.000Z" });
    const withdrawnNew = makePursuit({ id: "withdrawn-new", status: "withdrawn", updated_at: "2026-07-19T00:00:00.000Z" });

    const ordered = orderPursuits([rejectedOld, active, withdrawnNew]);
    assert.deepEqual(
        ordered.map((p) => p.id),
        ["active", "withdrawn-new", "rejected-old"],
    );
});

/* --------------------------------- mergeGuestPursuit --------------------------------- */

test("mergeGuestPursuit returns the guest pursuit verbatim when there is no existing record", () => {
    const guest = makePursuit({ id: "guest-1", status: "interested" });
    assert.equal(mergeGuestPursuit(undefined, guest), guest);
});

test("mergeGuestPursuit keeps the more advanced stage when guest is ahead", () => {
    const existing = makePursuit({ id: "server-1", status: "interested" });
    const guest = makePursuit({ id: "guest-1", status: "interviewing" });
    const merged = mergeGuestPursuit(existing, guest);
    assert.equal(merged.status, "interviewing");
    assert.equal(merged.id, "server-1", "identity fields (id) come from the existing server record");
});

test("mergeGuestPursuit keeps the existing stage when it is already more advanced (no downgrade)", () => {
    const existing = makePursuit({ id: "server-1", status: "offer" });
    const guest = makePursuit({ id: "guest-1", status: "applied" });
    const merged = mergeGuestPursuit(existing, guest);
    assert.equal(merged.status, "offer");
});

test("mergeGuestPursuit ties go to the existing record", () => {
    const existing = makePursuit({ id: "server-1", status: "applied" });
    const guest = makePursuit({ id: "guest-1", status: "applied" });
    const merged = mergeGuestPursuit(existing, guest);
    assert.equal(merged.status, "applied");
    assert.equal(merged.id, "server-1");
});

test("mergeGuestPursuit fills a missing snapshot/interview_date from guest without clobbering existing ones", () => {
    const snapshot = { title: "Eng", company: "Acme", location: null, description: null, apply_url: "https://x.test" };
    const existingNoSnapshot = makePursuit({ id: "server-1", status: "interested" });
    const guestWithSnapshot = makePursuit({ id: "guest-1", status: "interested", job_snapshot: snapshot });
    const merged = mergeGuestPursuit(existingNoSnapshot, guestWithSnapshot);
    assert.deepEqual(merged.job_snapshot, snapshot);

    const existingWithSnapshot = makePursuit({
        id: "server-2",
        status: "interested",
        job_snapshot: { ...snapshot, title: "Original" },
    });
    const merged2 = mergeGuestPursuit(existingWithSnapshot, guestWithSnapshot);
    assert.equal(merged2.job_snapshot?.title, "Original", "existing snapshot is not clobbered by a redundant guest one");
});

/* --------------------------------- stageLabel --------------------------------- */

test("stageLabel returns a non-empty word for every stage, no raw enum leaking through", () => {
    for (const status of PURSUIT_STAGES) {
        const label = stageLabel(makePursuit({ status }));
        assert.ok(label.length > 0, status);
        assert.notEqual(label, status, `"${status}" should be rendered as words, not the raw enum value`);
    }
});

/* --------------------------------- buildJobSnapshot --------------------------------- */

function makeJob(overrides: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "j1",
        title: "Senior Engineer",
        company: "Acme",
        company_domain: "acme.test",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: "Do the thing.",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://acme.test/apply",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ...overrides,
    };
}

test("buildJobSnapshot lifts exactly the fields a pursuit needs to remember", () => {
    const job = makeJob({ company: null, location: null, description: null });
    const snapshot = buildJobSnapshot(job);
    assert.deepEqual(snapshot, {
        title: "Senior Engineer",
        company: null,
        location: null,
        description: null,
        apply_url: "https://acme.test/apply",
    });
});

/* --------------------------------- buildManualPursuitSnapshot --------------------------------- */
// The search seed line's snapshot build (spec §3 "outside interviews") —
// typed company/role only, no live listing behind it.

test("buildManualPursuitSnapshot mirrors buildJobSnapshot's shape with the fields a typed seed has", () => {
    const snapshot = buildManualPursuitSnapshot("Acme", "Staff Engineer");
    assert.deepEqual(snapshot, {
        title: "Staff Engineer",
        company: "Acme",
        location: null,
        description: null,
        apply_url: "",
    });
});

/* --------------------------------- stageLabel + last_prepped_at --------------------------------- */

test("stageLabel appends a relative prepped-age only once last_prepped_at is set", () => {
    const notPrepped = makePursuit({ status: "interviewing" });
    assert.equal(stageLabel(notPrepped), "Interviewing");

    const now = Date.parse("2026-07-23T00:00:00.000Z");
    const prepped = makePursuit({
        status: "interviewing",
        last_prepped_at: "2026-07-21T00:00:00.000Z",
    });
    assert.equal(stageLabel(prepped, now), "Interviewing — prepped 2d ago");
});

test("stageLabel keeps the interview_date wording and appends prepped-age on top of it", () => {
    const now = Date.parse("2026-07-23T00:00:00.000Z");
    const p = makePursuit({
        status: "interviewing",
        interview_date: "2026-08-01T00:00:00.000Z",
        last_prepped_at: "2026-07-22T00:00:00.000Z",
    });
    assert.equal(stageLabel(p, now), "Interview scheduled — prepped 1d ago");
});

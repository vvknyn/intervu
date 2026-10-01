import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    NEEDS_YOU_MAX_ITEMS,
    buildNeedsYou,
    interviewDayLabel,
    savedRolesToCheck,
    starterSteps,
    type NeedsYouRemote,
} from "@/lib/jobs/for-you/needs-you";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";

const DAY = 86_400_000;
// Local wall-clock times, so "today" and "tomorrow" are the reader's own days.
const NOW = new Date(2026, 8, 29, 15, 0).getTime(); // Tuesday Sep 29, 3 PM
const ago = (ms: number) => new Date(NOW - ms).toISOString();
/** A picked interview date, stored as that day's UTC midnight. */
const picked = (offsetDays: number) => new Date(Date.UTC(2026, 8, 29 + offsetDays)).toISOString();

function pursuit(id: string, status: PursuitStage, updatedAgoMs: number, extra: Partial<Pursuit> = {}): Pursuit {
    return {
        id,
        user_id: "u",
        company_name: `Company ${id}`,
        position: `Role ${id}`,
        status,
        created_at: ago(updatedAgoMs + DAY),
        updated_at: ago(updatedAgoMs),
        ...extra,
    };
}

const NO_REMOTE: NeedsYouRemote = { searches: [], follows: [], closedJobIds: [], savedSearchCount: 0, followCount: 0 };

describe("buildNeedsYou", () => {
    it("orders by urgency: interviews, then quiet applications, then closed roles, then new roles", () => {
        const items = buildNeedsYou(
            [
                pursuit("applied", "applied", 10 * DAY),
                pursuit("saved", "interested", DAY, { job_id: "job-closed" }),
                pursuit("interview", "interviewing", DAY, { interview_date: picked(1) }),
            ],
            NOW,
            {
                ...NO_REMOTE,
                searches: [{ id: "s", name: "PM Toronto", href: "/jobs?view=search&q=pm", count: 4, more: false }],
                follows: [{ domain: "stripe.com", name: "Stripe", slug: "stripe", count: 10, more: true }],
                closedJobIds: ["job-closed"],
            },
        );
        assert.deepEqual(
            items.map((i) => i.kind),
            ["interview", "follow_up", "closed", "saved_search", "follow"],
        );
        assert.deepEqual(
            items.map((i) => i.title),
            [
                "Interview tomorrow",
                "Follow up with Company applied",
                "A saved role may have closed",
                "“PM Toronto” has 4 new",
                "Stripe posted 10+ roles",
            ],
        );
        assert.equal(items[0].href, "/yours/interview");
        assert.equal(items[1].detail, "No update in 10 days · Role applied");
        assert.equal(items[2].href, "/yours/saved");
        assert.equal(items[3].href, "/jobs?view=search&q=pm");
        assert.equal(items[4].href, "/co/stripe");
    });

    it("a guest's list is the device tracker alone", () => {
        const items = buildNeedsYou([pursuit("applied", "applied", 8 * DAY)], NOW, null);
        assert.deepEqual(
            items.map((i) => i.kind),
            ["follow_up"],
        );
    });

    it("groups several closed roles into one line pointing at the tracker", () => {
        const items = buildNeedsYou(
            [
                pursuit("a", "interested", DAY, { job_id: "j1" }),
                pursuit("b", "interested", DAY, { job_id: "j2" }),
                pursuit("c", "applied", DAY, { job_id: "j3" }),
            ],
            NOW,
            { ...NO_REMOTE, closedJobIds: ["j1", "j2", "j3"] },
        );
        assert.equal(items.length, 1);
        assert.equal(items[0].title, "2 saved roles may have closed");
        assert.equal(items[0].detail, "Company a, Company b");
        assert.equal(items[0].href, "/yours");
    });

    it("skips searches and companies with nothing new", () => {
        const items = buildNeedsYou([], NOW, {
            ...NO_REMOTE,
            searches: [{ id: "s", name: "Quiet", href: "/jobs?view=search", count: 0, more: false }],
            follows: [{ domain: "a.com", name: "A", slug: "a", count: 1, more: false }],
        });
        assert.deepEqual(
            items.map((i) => i.title),
            ["A posted 1 role"],
        );
    });

    it("keeps every item past the list's cap, longest waiting first", () => {
        const pursuits = Array.from({ length: NEEDS_YOU_MAX_ITEMS + 2 }, (_, i) => pursuit(`p${i}`, "applied", (8 + i) * DAY));
        const items = buildNeedsYou(pursuits, NOW, null);
        assert.equal(items.length, NEEDS_YOU_MAX_ITEMS + 2);
        assert.equal(items[0].key, `follow_up:p${NEEDS_YOU_MAX_ITEMS + 1}`);
    });
});

describe("interviewDayLabel", () => {
    it("says today, tomorrow, or the weekday", () => {
        assert.equal(interviewDayLabel(picked(0), NOW), "today");
        assert.equal(interviewDayLabel(picked(1), NOW), "tomorrow");
        assert.equal(interviewDayLabel(picked(3), NOW), "Friday");
        assert.equal(interviewDayLabel(null, NOW), null);
    });
});

describe("savedRolesToCheck", () => {
    it("checks saved roles tied to a listing, not applied or ended ones", () => {
        const ids = savedRolesToCheck([
            pursuit("saved", "interested", DAY, { job_id: "j1" }),
            pursuit("dupe", "interested", DAY, { job_id: "j1" }),
            pursuit("no-listing", "interested", DAY),
            pursuit("applied", "applied", DAY, { job_id: "j2" }),
            pursuit("withdrawn", "withdrawn", DAY, { job_id: "j3" }),
        ]);
        assert.deepEqual(ids, ["j1"]);
    });
});

describe("starterSteps", () => {
    it("ticks off as the account fills, and is gone once all three are done", () => {
        const steps = starterSteps([pursuit("a", "applied", DAY)], { ...NO_REMOTE, savedSearchCount: 1, followCount: 2 });
        assert.deepEqual(
            steps?.map((s) => [s.key, s.done]),
            [
                ["apply", false],
                ["save_search", true],
                ["follow", false],
            ],
        );
        const applied = ["a", "b", "c"].map((id) => pursuit(id, "applied", DAY));
        assert.equal(starterSteps(applied, { ...NO_REMOTE, savedSearchCount: 1, followCount: 3 }), null);
    });
});

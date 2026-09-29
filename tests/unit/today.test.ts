import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TODAY_FIRST_VISIT_LOOKBACK_MS,
    TODAY_SESSION_GAP_MS,
    followUpsDue,
    formatLastHere,
    interviewsThisWeek,
    pickNewForYou,
    resolveTodaySince,
    sincePhrase,
    todaySearchFloor,
    type TodayRole,
} from "@/lib/jobs/for-you/today";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
// `derivePostedTs` drops timestamps in the future of the real clock, so posted times hang off it.
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function job(id: string, postedAgoMs: number | null): PublicJob {
    return {
        id,
        title: "Product Manager",
        company: "Acme",
        company_domain: "acme.example",
        location: null,
        location_city: "Toronto",
        location_state: "ON",
        location_country: "Canada",
        work_type: "hybrid",
        description: null,
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: postedAgoMs == null ? null : ago(postedAgoMs),
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ghost_checked_at: null,
    } as PublicJob;
}

const role = (id: string, total: number, postedAgoMs: number | null): TodayRole => ({
    job: job(id, postedAgoMs),
    score: { total, components: [] },
});

function pursuit(id: string, status: PursuitStage, updatedAgoMs: number, extra: Partial<Pursuit> = {}): Pursuit {
    return {
        id,
        user_id: "u",
        company_name: "Acme",
        position: `Role ${id}`,
        status,
        created_at: ago(updatedAgoMs + DAY),
        updated_at: ago(updatedAgoMs),
        ...extra,
    };
}

describe("pickNewForYou", () => {
    const none = new Set<string>();

    it("keeps Strong and Good roles posted since the baseline, Strong first, then newest", () => {
        const since = NOW - 3 * DAY;
        const picks = pickNewForYou(
            [
                role("good-new", 65, 1 * HOUR),
                role("strong-old", 85, 2 * DAY),
                role("stretch", 40, 1 * HOUR),
                role("strong-new", 90, 5 * HOUR),
                role("before-baseline", 95, 4 * DAY),
                role("no-date", 95, null),
            ],
            { sinceMs: since, skipped: none, tracked: none },
        );
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["strong-new", "strong-old", "good-new"],
        );
    });

    it("drops roles skipped here or already in the tracker", () => {
        const picks = pickNewForYou([role("a", 85, HOUR), role("b", 85, HOUR), role("c", 85, HOUR)], {
            sinceMs: NOW - DAY,
            skipped: new Set(["a"]),
            tracked: new Set(["c"]),
        });
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["b"],
        );
    });
});

describe("resolveTodaySince", () => {
    it("a first visit has no baseline and starts the record", () => {
        const { sinceMs, next } = resolveTodaySince({ lastSeenAt: null, since: null }, NOW);
        assert.equal(sinceMs, null);
        assert.deepEqual(next, { lastSeenAt: new Date(NOW).toISOString(), since: null });
    });

    it("a later visit is measured from the previous one", () => {
        const last = ago(2 * DAY);
        const { sinceMs, next } = resolveTodaySince({ lastSeenAt: last, since: ago(5 * DAY) }, NOW);
        assert.equal(sinceMs, Date.parse(last));
        assert.equal(next.since, last);
    });

    it("a reload inside one sitting keeps the sitting's baseline, so the list doesn't empty itself", () => {
        const baseline = ago(2 * DAY);
        const first = resolveTodaySince({ lastSeenAt: baseline, since: null }, NOW - 10 * 60_000);
        const reload = resolveTodaySince(first.next, NOW);
        assert.equal(reload.sinceMs, Date.parse(baseline));
        assert.ok(NOW - Date.parse(first.next.lastSeenAt!) < TODAY_SESSION_GAP_MS);
    });

    it("a reload of a first visit stays a first visit", () => {
        const first = resolveTodaySince({ lastSeenAt: null, since: null }, NOW - 60_000);
        assert.equal(resolveTodaySince(first.next, NOW).sinceMs, null);
    });

    it("the search floor is the baseline, or a week back on a first visit", () => {
        assert.equal(todaySearchFloor(NOW - DAY, NOW), NOW - DAY);
        assert.equal(todaySearchFloor(null, NOW), NOW - TODAY_FIRST_VISIT_LOOKBACK_MS);
    });
});

describe("followUpsDue", () => {
    it("lists applications with no update for a week, longest waiting first", () => {
        const due = followUpsDue(
            [
                pursuit("fresh", "applied", 2 * DAY),
                pursuit("week", "applied", 7 * DAY + HOUR),
                pursuit("month", "applied", 30 * DAY),
                pursuit("interviewing", "interviewing", 30 * DAY),
                pursuit("saved", "interested", 30 * DAY),
                pursuit("rejected", "rejected", 30 * DAY),
            ],
            NOW,
        );
        assert.deepEqual(
            due.map((p) => p.id),
            ["month", "week"],
        );
    });
});

describe("interviewsThisWeek", () => {
    it("counts interviews from today through the next seven days, soonest first", () => {
        const at = (ms: number) => new Date(NOW + ms).toISOString();
        const list = interviewsThisWeek(
            [
                pursuit("thursday", "interviewing", DAY, { interview_date: at(3 * DAY) }),
                pursuit("tomorrow", "interviewing", DAY, { interview_date: at(DAY) }),
                pursuit("next-month", "interviewing", DAY, { interview_date: at(30 * DAY) }),
                pursuit("last-week", "interviewing", DAY, { interview_date: ago(8 * DAY) }),
                pursuit("withdrawn", "withdrawn", DAY, { interview_date: at(DAY) }),
                pursuit("no-date", "interviewing", DAY),
            ],
            NOW,
        );
        assert.deepEqual(
            list.map((p) => p.id),
            ["tomorrow", "thursday"],
        );
    });
});

describe("formatLastHere and sincePhrase", () => {
    // Local wall-clock times, so the day boundaries are the reader's own.
    const now = new Date(2026, 8, 29, 15, 0).getTime(); // Tuesday Sep 29, 3 PM

    it("says when the baseline was, in the visitor's own days", () => {
        assert.equal(formatLastHere(new Date(2026, 8, 29, 9, 0).getTime(), now), "earlier today");
        assert.equal(formatLastHere(new Date(2026, 8, 28, 23, 0).getTime(), now), "yesterday");
        assert.equal(formatLastHere(new Date(2026, 8, 25, 12, 0).getTime(), now), "Friday");
        assert.equal(formatLastHere(new Date(2026, 8, 12, 12, 0).getTime(), now), "Sep 12");
    });

    it("a first visit has no last-here and covers this week", () => {
        assert.equal(formatLastHere(null, now), null);
        assert.equal(sincePhrase(null, now), "this week");
    });

    it("the count reads since the last visit", () => {
        assert.equal(sincePhrase(new Date(2026, 8, 29, 9, 0).getTime(), now), "today");
        assert.equal(sincePhrase(new Date(2026, 8, 28, 9, 0).getTime(), now), "since yesterday");
        assert.equal(sincePhrase(new Date(2026, 8, 25, 9, 0).getTime(), now), "since Friday");
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TODAY_FIRST_VISIT_LOOKBACK_MS,
    TODAY_SESSION_GAP_MS,
    followUpsDue,
    formatLastHere,
    interviewDayMs,
    interviewsThisWeek,
    isNewPick,
    isNewSince,
    pickToday,
    placeCheckIds,
    resolveTodaySince,
    sincePhrase,
    todayLeftOut,
    todaySearchFloor,
    todaySummary,
    tuneToday,
    type TodayRole,
} from "@/lib/jobs/for-you/today";
import { roleFeatures, type TuningNudge } from "@/lib/jobs/for-you/tuning";
import type { MatchComponent, MatchReason, MatchScore, RoleAffinity } from "@/lib/match/score";
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

function score(total: number, role: RoleAffinity = "own", reasons: MatchReason[] = [], familyRank = 0): MatchScore {
    const components: MatchComponent[] = [
        { key: "relevance", label: "Relevance", detail: "", score: total / 100 },
        ...reasons.map((reason): MatchComponent => ({
            key: reason.startsWith("level") ? "seniority" : "location",
            label: "",
            detail: "",
            score: 0.5,
            reason,
        })),
    ];
    return { total, components, role, familyRank };
}

const role = (
    id: string,
    total: number,
    postedAgoMs: number | null,
    opts: { affinity?: RoleAffinity; reasons?: MatchReason[]; title?: string; company?: string; city?: string; familyRank?: number } = {},
): TodayRole => {
    const j = job(id, postedAgoMs);
    if (opts.title) j.title = opts.title;
    if (opts.company) j.company = opts.company;
    if (opts.city) j.location_city = opts.city;
    return { job: j, score: score(total, opts.affinity ?? "own", opts.reasons ?? [], opts.familyRank ?? 0) };
};

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

describe("todayLeftOut", () => {
    it("keeps a Strong or Good role of the candidate's own kind, at their level, where they can work", () => {
        assert.equal(todayLeftOut(score(85, "own", ["level_fits", "same_country"])), null);
        assert.equal(todayLeftOut(score(65, "family", ["level_above_ask", "remote_same_country"])), null);
        // An unlisted level or place is not a reason to leave a role out; the score already caps it.
        assert.equal(todayLeftOut(score(70, "own", ["level_unlisted", "country_unlisted"])), null);
    });

    it("keeps a title the résumé does not name when the posting fits, and leaves out a Stretch, another kind of job, a role above their level and one abroad", () => {
        assert.equal(todayLeftOut(score(55, "own")), "stretch");
        for (const affinity of ["adjacent", "unverified"] as const) {
            assert.equal(todayLeftOut(score(75, affinity)), null, affinity);
            assert.equal(todayLeftOut(score(55, affinity)), "stretch", affinity);
        }
        assert.equal(todayLeftOut(score(75, "off-target")), "other-role");
        assert.equal(todayLeftOut(score(75, "own", ["level_below_ask"])), "level");
        assert.equal(todayLeftOut(score(75, "own", ["abroad"])), "abroad");
        assert.equal(todayLeftOut(score(75, "own", ["remote_abroad"])), "abroad");
    });

    it("leaves a role outside the candidate's countries out for its place, not as a Stretch", () => {
        // Its total sits under Good for the place alone (`MatchScore.outside`).
        const outside = {
            ...score(59, "own", ["remote_pay_abroad"]),
            outside: { home: ["Canada"], where: "United States", currency: "USD", from: "resume" as const, total: 78 },
        };
        assert.equal(todayLeftOut(outside), "abroad");
    });
});

describe("placeCheckIds", () => {
    it("still reads the description of an own-role pick left out only for its pay's currency", () => {
        const remote = (id: string): PublicJob => ({ ...job(id, HOUR), location_city: null, location_state: null, location_country: null, work_type: "remote" });
        const paidAbroad: TodayRole = {
            job: remote("usd"),
            score: {
                ...score(59, "own", ["level_fits", "remote_pay_abroad"]),
                outside: { home: ["Canada"], where: "United States", currency: "USD", from: "resume", total: 78 },
            },
        };
        const stretch: TodayRole = { job: remote("weak"), score: score(45, "own", ["level_fits", "remote_anywhere"]) };
        assert.deepEqual(placeCheckIds([stretch, paidAbroad], 8), ["usd"]);
    });
});

describe("pickToday", () => {
    const none = new Set<string>();

    it("orders the kept roles as every ranked list does: the fit band, then the higher fit, the title only lifting a little, then newest", () => {
        const picks = pickToday(
            [
                role("family-strong", 92, 1 * HOUR, { affinity: "family", title: "Customer Success Manager" }),
                role("own-good-old", 70, 3 * DAY, { title: "Account Manager" }),
                role("own-strong", 88, 5 * HOUR, { title: "Technical Account Manager" }),
                role("own-good-new", 70, 1 * HOUR, { title: "Account Manager II" }),
                role("neighbour", 79, HOUR, { affinity: "adjacent", title: "Product Manager" }),
                role("stretch", 40, HOUR, { title: "Other" }),
            ],
            { skipped: none, tracked: none },
        );
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["family-strong", "own-strong", "neighbour", "own-good-new", "own-good-old"],
            "the better fit leads whatever its title; a title the résumé does not name is kept when it fits, ahead of a weaker one it does",
        );
    });

    it("lets the résumé's own title break a tie, and nothing more", () => {
        const picks = pickToday(
            [
                role("family", 88, HOUR, { affinity: "family", title: "Customer Success Manager" }),
                role("neighbour", 88, HOUR, { affinity: "adjacent", title: "Product Manager" }),
                role("own", 88, HOUR, { title: "Technical Account Manager" }),
            ],
            { skipped: none, tracked: none },
        );
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["own", "family", "neighbour"],
        );
    });

    it("puts picks this device hasn't shown before ahead of ones it has, inside the same fit band only", () => {
        // "I keep seeing the same result" (2026-10-06): score order alone led every visit with the same roles.
        const roles = [
            role("strong-seen", 90, HOUR, { title: "A" }),
            role("good-seen", 79, HOUR, { title: "B" }),
            role("good-new", 74, HOUR, { title: "C" }),
            role("strong-new", 86, HOUR, { title: "D" }),
        ];
        const order = (seenBefore: ReadonlySet<string> | null) =>
            pickToday(roles, { skipped: new Set(), tracked: new Set(), seenBefore }).map((r) => r.job.id);
        assert.deepEqual(order(null), ["strong-seen", "strong-new", "good-seen", "good-new"]);
        assert.deepEqual(order(new Set(["strong-seen", "good-seen"])), ["strong-new", "strong-seen", "good-new", "good-seen"]);
    });

    it("drops roles skipped here or already in the tracker", () => {
        const picks = pickToday([role("a", 85, HOUR), role("b", 85, HOUR, { title: "B" }), role("c", 85, HOUR, { title: "C" })], {
            skipped: new Set(["a"]),
            tracked: new Set(["c"]),
        });
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["b"],
        );
    });

    it("lists an opening once: same title, company and place; another city is another opening", () => {
        const picks = pickToday(
            [
                role("toronto", 85, HOUR, { title: "Barista", company: "Balzac's", city: "Toronto" }),
                role("toronto-again", 85, 2 * HOUR, { title: "Barista", company: "Balzac's", city: "Toronto" }),
                role("richmond-hill", 85, 3 * HOUR, { title: "Barista", company: "Balzac's", city: "Richmond Hill" }),
            ],
            { skipped: none, tracked: none },
        );
        assert.deepEqual(
            picks.map((r) => r.job.id),
            ["toronto", "richmond-hill"],
        );
    });
});

describe("tuneToday", () => {
    const deck = [
        role("tam-1", 90, HOUR, { title: "Technical Account Manager", company: "Okta" }),
        role("sec-1", 89, HOUR, { title: "Technical Account Manager, Security", company: "Elastic" }),
        role("tam-2", 88, HOUR, { title: "Technical Account Manager", company: "Datadog" }),
        role("sec-2", 87, HOUR, { title: "Technical Account Manager, Security", company: "Snowflake" }),
        role("tam-3", 86, HOUR, { title: "Technical Account Manager", company: "Twilio" }),
    ];
    const nudge = (r: TodayRole, signal: TuningNudge["signal"]): TuningNudge => ({
        jobId: r.job.id,
        signal,
        at: NOW,
        features: roleFeatures(r.job, deck.map((d) => d.job)),
    });

    it("returns the picks as they were with no ratings", () => {
        assert.equal(tuneToday(deck, [], [], NOW), deck);
    });

    it("a thumbs down on a security role moves the other security roles down, never out", () => {
        const rest = deck.filter((r) => r.job.id !== "sec-1");
        const tuned = tuneToday(rest, [nudge(deck[1], "fewer")], ["tam-1"], NOW).map((r) => r.job.id);
        assert.deepEqual(tuned.slice(0, 3), ["tam-1", "tam-2", "tam-3"]);
        assert.ok(tuned.includes("sec-2"));
    });

    it("rows the visitor already rated stay where they are", () => {
        const tuned = tuneToday(deck, [nudge(deck[4], "more")], ["tam-1", "sec-1"], NOW).map((r) => r.job.id);
        assert.deepEqual(tuned.slice(0, 2), ["tam-1", "sec-1"]);
    });
});

describe("isNewSince", () => {
    it("is new when posted at or after the last visit; nothing is new on a first visit", () => {
        assert.equal(isNewSince(job("a", HOUR), NOW - DAY), true);
        assert.equal(isNewSince(job("b", 2 * DAY), NOW - DAY), false);
        assert.equal(isNewSince(job("c", null), NOW - DAY), false);
        assert.equal(isNewSince(job("d", HOUR), null), false);
    });
});

describe("isNewPick", () => {
    it("is new when this device hadn't listed it, whatever its posting date", () => {
        // Posted two days ago but reached search after the last visit: new. Posted an hour ago but already listed: not.
        const seen = new Set(["listed"]);
        assert.equal(isNewPick(job("late", 2 * DAY), seen, NOW - DAY), true);
        assert.equal(isNewPick(job("listed", HOUR), seen, NOW - DAY), false);
    });

    it("falls back to the posting date until the device keeps a list, and counts every pick on a first visit", () => {
        assert.equal(isNewPick(job("a", HOUR), null, NOW - DAY), true);
        assert.equal(isNewPick(job("b", 2 * DAY), null, NOW - DAY), false);
        assert.equal(isNewPick(job("c", 2 * DAY), null, null), true);
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
    it("reads a picked date (stored as its UTC midnight) as that calendar day, in any zone", () => {
        const today = new Date(NOW);
        const picked = (offsetDays: number) =>
            new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays)).toISOString();
        assert.equal(interviewDayMs(picked(0)), new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime());
        const list = interviewsThisWeek(
            [
                pursuit("today", "interviewing", DAY, { interview_date: picked(0) }),
                pursuit("sixth-day", "interviewing", DAY, { interview_date: picked(6) }),
                pursuit("eighth-day", "interviewing", DAY, { interview_date: picked(7) }),
                pursuit("yesterday", "interviewing", DAY, { interview_date: picked(-1) }),
            ],
            NOW,
        );
        assert.deepEqual(
            list.map((p) => p.id),
            ["today", "sixth-day"],
        );
    });

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

describe("todaySummary", () => {
    const base = { ready: true, shown: 1, newCount: 0, firstVisit: false, since: "today", appliedToday: 0, appliedWaiting: 11 };

    it("nothing new: says so, names the next step for the role still listed, and counts what's waiting in Applied (no daily goal)", () => {
        // Vivek, 2026-10-07: "0/12, 0 picks...but 11 applied...and 1 role to look at....so much confusion".
        assert.deepEqual(todaySummary(base), {
            picks: "No new roles fit you since you were here earlier today.",
            next: "Apply to the role below, or give it a thumbs down so it stops showing.",
            appliedToday: null,
            waiting: "11 applications are waiting on a reply",
        });
        const many = todaySummary({ ...base, shown: 4, since: "since Friday" });
        assert.equal(many.picks, "No new roles fit you since Friday.");
        assert.equal(many.next, "Apply to the roles below that suit you, and give the rest a thumbs down so they stop showing.");
    });

    it("new picks: counts them since the last visit and points at the New ones at the top", () => {
        const one = todaySummary({ ...base, shown: 5, newCount: 1, since: "since Tuesday" });
        assert.equal(one.picks, "1 new role fits you since Tuesday.");
        assert.equal(one.next, "It's at the top, marked New. Apply if it suits you.");
        const two = todaySummary({ ...base, shown: 5, newCount: 2, since: "since yesterday" });
        assert.equal(two.picks, "2 new roles fit you since yesterday.");
        assert.equal(two.next, "They're at the top, marked New. Apply to the ones that suit you.");
    });

    it("a first visit counts the week's picks, none marked New", () => {
        const first = todaySummary({ ...base, firstVisit: true, since: "this week", shown: 2, newCount: 2, appliedWaiting: 0 });
        assert.deepEqual(first, {
            picks: "2 roles posted this week fit you.",
            next: "Look at them below and apply to the ones that suit you.",
            appliedToday: null,
            waiting: null,
        });
    });

    it("no picks listed (loading, failed, empty, no résumé): only the applications speak", () => {
        for (const input of [{ ...base, ready: false }, { ...base, shown: 0 }]) {
            const s = todaySummary({ ...input, appliedToday: 1, appliedWaiting: 1 });
            assert.equal(s.picks, null);
            assert.equal(s.next, null);
            assert.equal(s.appliedToday, "You applied to 1 role today.");
            assert.equal(s.waiting, "1 application is waiting on a reply");
        }
        const none = todaySummary({ ...base, ready: false, appliedWaiting: 0 });
        assert.deepEqual(none, { picks: null, next: null, appliedToday: null, waiting: null });
    });
});

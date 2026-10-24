/**
 * A company page waits for its roles and, for at most `sideTimeoutMs` each, its
 * side reads: news, recent changes and the box database's record (hiring
 * record, posting chart, profile). A read still out at its timeout is left off
 * that render (null fields, logged once) instead of holding the page (the first Amazon visit took 4.3s on
 * release 16, and a cold box read still held release 23's first Amazon visit
 * for a second). A late box read lands in a per-employer cache so the next
 * visit has it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
import { createExhaustCache } from "@/lib/companies/exhaust-cache";
import { getCompanyPageData, type CompanySideReads } from "@/lib/companies/get-company";
import type { CompanyChangeEvent, CompanyNewsArticle } from "@/lib/companies/types";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { LogAttrs } from "@/lib/observability/posthog-logs";

function job(id: string): PublicJob {
    return {
        id,
        title: `Engineer ${id}`,
        company: "Acme",
        company_domain: "acme.com",
        location: null,
        location_city: `City ${id}`,
        location_state: null,
        location_country: null,
        work_type: "remote",
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
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
    };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function after<T>(ms: number, value: T): Promise<T> {
    return wait(ms).then(() => value);
}

const searchIn =
    (ms: number, extra: Partial<JobSearchResult> = {}): ((p: JobSearchParams) => Promise<JobSearchResult>) =>
    () =>
        after(ms, { hits: [job("1"), job("2")], total: 2, backend: "meilisearch", configured: true, ...extra });

const BOX = { profile: null, cadence: null, integrity: null } as unknown as CompanyExhaust;
const NEWS = [{ title: "Acme raises" }] as unknown as CompanyNewsArticle[];
const EVENTS = [{ title: "Acme hires" }] as unknown as CompanyChangeEvent[];

type Logged = { body: string; attrs: LogAttrs };

function reads(times: { news?: number; events?: number; box?: number }, logged: Logged[] = []): Partial<CompanySideReads> {
    return {
        news: () => after(times.news ?? 0, NEWS),
        events: () => after(times.events ?? 0, EVENTS),
        exhaust: () => after(times.box ?? 0, BOX),
        budgetMs: 60,
        sideTimeoutMs: 100,
        log: (_level, body, attrs) => logged.push({ body, attrs }),
    };
}

describe("getCompanyPageData — side reads are awaited, each up to its own timeout", () => {
    it("leaves off a box read that is still out at its timeout, and does not wait beyond it", async () => {
        const started = Date.now();
        const data = await getCompanyPageData("acme--com", searchIn(5), reads({ box: 400 }));
        const elapsed = Date.now() - started;

        assert.ok(data);
        assert.equal(data.jobs.length, 2);
        assert.equal(data.exhaust, null, "the box bands are left off this render");
        assert.equal(data.facts.identity.sector, null, "its facts are null, not placeholders");
        assert.deepEqual(data.changeEvents, EVENTS, "reads that answered in time are kept");
        assert.ok(elapsed >= 90 && elapsed < 300, `the page waited ${elapsed} ms for a 400 ms read with a 100 ms timeout`);
    });

    it("keeps a read that answers inside its timeout even when the search answered first", async () => {
        const data = await getCompanyPageData("acme--com", searchIn(5), reads({ box: 60 }));
        assert.ok(data);
        assert.equal(data.exhaust, BOX);
    });

    it("asks the search for facets, so the mix covers every live role and not the 200 fetched", async () => {
        let seen: JobSearchParams | undefined;
        const search = (p: JobSearchParams) => {
            seen = p;
            return searchIn(0)(p);
        };
        await getCompanyPageData("acme--com", search, reads({}));
        assert.equal(seen?.withFacets, true);
    });

    it("leaves off late news and recent changes the same way", async () => {
        const data = await getCompanyPageData("acme--com", searchIn(5), reads({ news: 400, events: 400 }));
        assert.ok(data);
        assert.deepEqual(data.changeEvents, []);
        assert.equal(data.exhaust, BOX);
    });

    it("keeps every side read that answers before the search", async () => {
        const data = await getCompanyPageData("acme--com", searchIn(50), reads({ news: 10, events: 10, box: 20 }));
        assert.ok(data);
        assert.equal(data.exhaust, BOX);
        assert.deepEqual(data.changeEvents, EVENTS);
    });

    it("keeps a slow side read when the search is slower still", async () => {
        const data = await getCompanyPageData("acme--com", searchIn(200), reads({ box: 80 }));
        assert.ok(data);
        assert.equal(data.exhaust, BOX, "the page was waiting for the search anyway");
    });
});

describe("getCompanyPageData — a read over budget is logged with all four times", () => {
    it("logs once the late read answers, naming what was left off", async () => {
        const logged: Logged[] = [];
        await getCompanyPageData("acme--com", searchIn(5), reads({ box: 150 }, logged));
        assert.equal(logged.length, 0, "not before the late read has its time");
        await wait(200);

        assert.equal(logged.length, 1);
        const { body, attrs } = logged[0];
        assert.equal(body, "company page reads over budget");
        assert.equal(attrs["company.domain"], "acme.com");
        assert.equal(attrs["left.off"], "box");
        assert.equal(attrs["budget.ms"], 60);
        assert.ok(Number(attrs["box.ms"]) >= 150, `box.ms ${attrs["box.ms"]}`);
        for (const key of ["search.ms", "news.ms", "events.ms"]) {
            assert.equal(typeof attrs[key], "number", key);
        }
    });

    it("logs a slow search too, with nothing left off and the engine's own share of it", async () => {
        const logged: Logged[] = [];
        await getCompanyPageData("acme--com", searchIn(100, { engineMs: 12, engineCalls: 2 }), reads({}, logged));
        await wait(20);
        assert.equal(logged.length, 1);
        assert.equal(logged[0].attrs["left.off"], undefined);
        assert.ok(Number(logged[0].attrs["search.ms"]) >= 100);
        assert.equal(logged[0].attrs["search.engine.ms"], 12);
        assert.equal(logged[0].attrs["search.calls"], 2);
    });

    it("logs nothing when the search is inside the budget and every read beat it", async () => {
        const logged: Logged[] = [];
        await getCompanyPageData("acme--com", searchIn(30), reads({ news: 5, events: 5, box: 5 }, logged));
        await wait(100);
        assert.equal(logged.length, 0);
    });
});

describe("createExhaustCache — a late box read reaches the next visit", () => {
    function counter(result: { complete: boolean; ms?: number }) {
        let calls = 0;
        const read = async () => {
            calls += 1;
            await wait(result.ms ?? 0);
            return { exhaust: BOX, complete: result.complete };
        };
        return { read, calls: () => calls };
    }

    it("serves a complete read again without another query", async () => {
        const box = counter({ complete: true });
        const get = createExhaustCache(box.read);
        assert.equal(await get("acme.com"), BOX);
        assert.equal(await get("acme.com"), BOX);
        assert.equal(box.calls(), 1);
    });

    it("never keeps a read that lost a section, so a recovered box shows it next time", async () => {
        const box = counter({ complete: false });
        const get = createExhaustCache(box.read);
        await get("acme.com");
        await get("acme.com");
        assert.equal(box.calls(), 2);
    });

    it("shares one read between visits that arrive while it is out", async () => {
        const box = counter({ complete: true, ms: 30 });
        const get = createExhaustCache(box.read);
        await Promise.all([get("acme.com"), get("acme.com"), get("acme.com")]);
        assert.equal(box.calls(), 1);
    });

    it("serves an hour-old entry at once and refreshes it behind the visit", async () => {
        let now = 0;
        const box = counter({ complete: true, ms: 30 });
        const get = createExhaustCache(box.read, { now: () => now, freshMs: 100, maxAgeMs: 1_000 });
        await get("acme.com");
        now = 500;
        const started = Date.now();
        assert.equal(await get("acme.com"), BOX);
        assert.ok(Date.now() - started < 25, "the stale entry did not wait on the refresh");
        await wait(50);
        assert.equal(box.calls(), 2);
    });

    it("waits for a new read once an entry is older than the longest it may be served", async () => {
        let now = 0;
        const box = counter({ complete: true });
        const get = createExhaustCache(box.read, { now: () => now, freshMs: 100, maxAgeMs: 1_000 });
        await get("acme.com");
        now = 2_000;
        await get("acme.com");
        assert.equal(box.calls(), 2);
    });

    it("drops the least recently used employer when full", async () => {
        const box = counter({ complete: true });
        const get = createExhaustCache(box.read, { maxEntries: 2 });
        await get("a.com");
        await get("b.com");
        await get("a.com"); // a is now the most recent
        await get("c.com"); // evicts b
        assert.equal(box.calls(), 3);
        await get("a.com");
        assert.equal(box.calls(), 3, "a was kept");
        await get("b.com");
        assert.equal(box.calls(), 4, "b was dropped");
    });

    it("answers no box data when the read throws", async () => {
        const get = createExhaustCache(async () => {
            throw new Error("pool exhausted");
        });
        assert.equal(await get("acme.com"), null);
    });
});

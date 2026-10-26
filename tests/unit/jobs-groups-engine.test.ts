/**
 * The real engine, not a mock: pages a typed search through `searchMeili` against a throwaway LOCAL Meilisearch
 * 1.45.2 (the version prod runs) holding a fixture shaped like the prod defect ("speech therapist" + Freshest:
 * old known hits, fresher alias hits, fresher description-only hits). Skipped unless MEILI_TEST_URL points at a
 * local engine:
 *   meilisearch --db-path /tmp/x --http-addr 127.0.0.1:7799 --master-key k --env development
 *   MEILI_TEST_URL=http://127.0.0.1:7799 MEILI_TEST_KEY=k npx tsx tests/unit/jobs-groups-engine.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JOBS_INDEX, JOBS_INDEX_SETTINGS, resetCompanyIntentCacheForTests, searchMeili } from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams, PublicJob } from "../../src/lib/jobs/types";

const URL_ = process.env.MEILI_TEST_URL ?? "";
const KEY = process.env.MEILI_TEST_KEY ?? "";
const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_);
const DAY = 86_400_000;
const NOW = Date.now();
const PAGE = 5;

const call = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${URL_}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: body ? JSON.stringify(body) : undefined });
    return (await res.json()) as { taskUid?: number; status?: string };
};
async function settled(task: { taskUid?: number }) {
    for (;;) {
        const t = await call(`/tasks/${task.taskUid}`, "GET");
        if (t.status === "succeeded") return;
        assert.notEqual(t.status, "failed", JSON.stringify(t));
        await new Promise((r) => setTimeout(r, 100));
    }
}

let n = 0;
const doc = (title: string, daysOld: number, extra: Record<string, unknown> = {}) => ({
    id: `d${n++}`, title, company: `Employer ${n}`, description: "Role description.", tags: [], location: "Austin, TX",
    vacancy_status: "open", ghost_badge: "unscored", posted_ts: NOW - daysOld * DAY, ...extra,
});
const many = (count: number, make: (i: number) => ReturnType<typeof doc>) => Array.from({ length: count }, (_, i) => make(i));

const DOCS = [
    // every typed word in the title or keywords: OLD (months)
    ...many(8, (i) => doc("Speech Therapist", 40 + i * 4)),
    ...many(8, (i) => doc("Clinical Fellow/Therapist", 42 + i * 4, { tags: ["speech"] })),
    // another name for the same job, in the title: FRESH
    ...many(8, (i) => doc("Speech Language Pathologist", 2 + i * 3)),
    ...many(4, (i) => doc("Physical Therapist", 30 + i)),
    ...many(8, (i) => doc("Physiotherapist", 3 + i * 5)),
    // every word only somewhere else in the posting: FRESHEST of all
    ...many(12, (i) => doc("Classroom Teacher", 1 + i * 2, { description: "Works with a speech therapist on site." })),
    ...many(12, (i) => doc("Office Assistant", 1 + i * 2, { description: "Sits beside our physical therapist." })),
    // a filter that admits un-derived rows: known salary OLD, no salary FRESH
    ...many(5, (i) => doc("Welder", 50 + i, { salary_max: 150_000, salary_min: 120_000 })),
    ...many(5, (i) => doc("Welder", 1 + i)),
];

async function pages(p: JobSearchParams) {
    const all: PublicJob[] = [];
    let total = 0;
    for (let offset = 0; ; offset += PAGE) {
        const r = await searchMeili({ ...p, limit: PAGE, offset });
        total = r.total;
        if (r.hits.length === 0) break;
        all.push(...r.hits);
        assert.ok(offset < 500, "paging must end");
    }
    return { all, total };
}
const postedTs = (j: PublicJob) => (j as { posted_ts?: number }).posted_ts ?? 0;
const inOrder = (hits: PublicJob[]) => hits.every((h, i) => i === 0 || postedTs(hits[i - 1]) >= postedTs(h));

describe("typed search groups on the real engine", { skip: !local && "MEILI_TEST_URL is not a local engine" }, () => {
    before(async () => {
        process.env.MEILISEARCH_HOST = URL_;
        process.env.MEILISEARCH_SEARCH_KEY = KEY;
        resetCompanyIntentCacheForTests();
        await call(`/indexes/${JOBS_INDEX}`, "DELETE");
        await new Promise((r) => setTimeout(r, 300));
        await settled(await call("/indexes", "POST", { uid: JOBS_INDEX, primaryKey: "id" }));
        await settled(await call(`/indexes/${JOBS_INDEX}/settings`, "PATCH", JOBS_INDEX_SETTINGS));
        await settled(await call(`/indexes/${JOBS_INDEX}/documents`, "POST", DOCS));
    });
    after(async () => {
        if (local) await call(`/indexes/${JOBS_INDEX}`, "DELETE");
    });

    for (const q of ["speech therapist", "physical therapist"]) {
        it(`${q} + Freshest: each group is newest-first across every page, and the groups do not mix`, async () => {
            const { all } = await pages({ q, sort: "newest" });
            const above = all.filter((h) => h.tier === 1);
            const below = all.filter((h) => h.tier === 2);
            assert.ok(above.length > PAGE && below.length > PAGE, "both groups span more than one page");
            assert.ok(inOrder(above), "above the divider: newest first over all pages");
            assert.ok(inOrder(below), "below the divider: newest first over all pages");
            assert.equal(all.findIndex((h) => h.tier === 2), above.length, "every card above the divider comes before every card below it");
        });

        it(`${q}: the set is the same under Freshest and Relevance`, async () => {
            const ids = async (sort: "newest" | "relevance") => (await pages({ q, sort })).all.map((h) => h.id).sort();
            const fresh = await ids("newest");
            assert.deepEqual(fresh, await ids("relevance"));
            assert.equal(new Set(fresh).size, fresh.length, "no card twice");
        });

        it(`${q}: above the divider is true of every card, and the count below is the cards below`, async () => {
            const { all, total } = await pages({ q, sort: "newest" });
            const words = q.split(" ");
            for (const h of all.filter((x) => x.tier === 1)) {
                const text = `${h.title} ${h.company} ${(h.tags ?? []).join(" ")}`.toLowerCase();
                const named = words.every((w) => text.includes(w)) || /pathologist|physiotherapist/i.test(h.title);
                assert.ok(named, `"${h.title}" is not a typed or alias title match`);
            }
            for (const h of all.filter((x) => x.tier === 2)) {
                assert.ok(!/therapist|pathologist|physiotherapist/i.test(h.title), `"${h.title}" belongs above the divider`);
            }
            assert.equal(total - all.filter((h) => h.tier === 1).length, all.filter((h) => h.tier === 2).length);
        });
    }

    it("Relevance: another name for the job ranks after the typed words' own matches", async () => {
        const { all } = await pages({ q: "speech therapist", sort: "relevance" });
        const firstAlias = all.findIndex((h) => /pathologist/i.test(h.title));
        const lastTyped = all.map((h) => /^speech therapist$/i.test(h.title)).lastIndexOf(true);
        assert.ok(firstAlias > lastTyped, `alias at ${firstAlias}, last exact title at ${lastTyped}`);
    });

    it("a query with no aliases keeps the same guarantees", async () => {
        const { all } = await pages({ q: "welder", sort: "newest" });
        assert.equal(all.length, 10);
        assert.ok(all.every((h) => h.tier === 1));
        assert.ok(inOrder(all));
    });

    it("a fresher unknown-inclusive hit leads an older known one under Freshest, and trails it under Relevance", async () => {
        const p = { q: "welder", salaryMin: 100_000 } as JobSearchParams;
        const fresh = (await pages({ ...p, sort: "newest" })).all;
        assert.ok(inOrder(fresh), "date order over known and unknown alike");
        assert.equal(fresh[0].salary_max ?? null, null, "the freshest card has no stated pay and leads");
        const relevance = (await pages({ ...p, sort: "relevance" })).all;
        assert.ok(relevance.slice(0, 5).every((h) => h.salary_max != null), "Relevance keeps the stated-pay cards first");
    });
});

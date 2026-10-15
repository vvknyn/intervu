import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    countFitBands,
    hubListedHits,
    formatAllPackHubLabels,
    formatBrowseHubCorpusLine,
    formatHubCorpusLine,
    formatHubCountLabel,
    formatHubPackCorpusRoleLabel,
    formatHubPackCorpusRoleLabels,
    formatHubRoleCount,
    freshHubProbeMemo,
    HUB_PROBE_MEMO_MS,
    keywordPackLowerBound,
    resolveBrowseHubRoleCountLabels,
    resolveHubRoleCountLabels,
    packBandTotalsFromSources,
    resolveAllMatchesHubCount,
    resolveAllPackHubCounts,
    resumeHubPackCounts,
} from "../../src/lib/jobs/for-you/hub-counts";
import { deckListLoading } from "../../src/lib/jobs/for-you/deck-list-loading";
import {
    diffHubPackRemovals,
    formatHubRemovalsLine,
} from "../../src/lib/jobs/for-you/hub-count-memory";
import { jobMatchesHubPack } from "../../src/lib/jobs/for-you/hub-pack-filters";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

function score(total: number): MatchScore {
    return { total, components: [] };
}

function job(partial: Partial<PublicJob> & Pick<PublicJob, "id" | "title">): PublicJob {
    return {
        id: partial.id,
        title: partial.title,
        company: partial.company ?? "Acme",
        company_domain: null,
        location: partial.location ?? null,
        location_city: partial.location_city ?? null,
        location_state: partial.location_state ?? null,
        location_country: partial.location_country ?? null,
        work_type: partial.work_type ?? "onsite",
        description: null,
        employment_type: "full_time",
        experience_level: partial.experience_level ?? "senior",
        salary_min: partial.salary_min ?? null,
        salary_max: partial.salary_max ?? null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: partial.tags ?? [],
        occupation: partial.occupation ?? null,
        apply_url: partial.apply_url ?? "https://example.com/apply",
        source: "test",
        posted_at: partial.posted_at ?? null,
        first_seen_at: null,
        posted_ts: partial.posted_ts ?? null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
    };
}

describe("formatHubCountLabel", () => {
    it("never invents — omit and loading are honest", () => {
        assert.equal(formatHubCountLabel({ kind: "omit" }), "");
        assert.equal(formatHubCountLabel({ kind: "loading" }), "Matches loading");
    });

    it("formats totals without fake pack numbers", () => {
        assert.equal(formatHubCountLabel({ kind: "total", total: 1 }), "1 match");
        assert.equal(formatHubCountLabel({ kind: "total", total: 60 }), "60 matches");
        assert.doesNotMatch(formatHubCountLabel({ kind: "total", total: 60 }), /24 jobs|18 jobs|42 jobs/);
    });

    it("prefers Strong · Good and can append pool", () => {
        assert.equal(
            formatHubCountLabel({ kind: "bands", strong: 12, good: 8 }),
            "12 Strong · 8 Good",
        );
        assert.equal(formatHubCountLabel({ kind: "bands", strong: 5, good: 0 }), "5 Strong");
        assert.equal(
            formatHubCountLabel({ kind: "bands", strong: 47, good: 12, pool: 508 }),
            "47 Strong · 12 Good · ~508 pool",
        );
    });
});

describe("formatHubCorpusLine", () => {
    it("surfaces corpus total and matching state", () => {
        assert.equal(formatHubCorpusLine(508, false), "~508 matches ranked Strong first");
        assert.match(formatHubCorpusLine(508, true), /Matching/);
        assert.equal(formatHubCorpusLine(null, false), "");
    });
});

describe("resolveAllMatchesHubCount", () => {
    it("uses bands when scored hits exist", () => {
        const source = resolveAllMatchesHubCount({
            loading: false,
            total: 200,
            scores: [score(90), score(70), score(40), null],
            pool: 200,
        });
        assert.equal(source.kind, "bands");
        if (source.kind === "bands") {
            assert.equal(source.strong, 1);
            assert.equal(source.good, 1);
            assert.equal(source.pool, 200);
        }
    });

    it("falls back to total, then loading, then omit", () => {
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: false, total: 42, scores: null }),
            { kind: "total", total: 42 },
        );
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: true, total: null, scores: null }),
            { kind: "loading" },
        );
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: false, total: null, scores: null }),
            { kind: "omit" },
        );
    });
});

describe("countFitBands", () => {
    it("buckets Strong / Good / Stretch / unscored", () => {
        const bands = countFitBands([score(80), score(60), score(59), null, undefined]);
        assert.deepEqual(bands, { strong: 1, good: 1, stretch: 1, unscored: 2 });
    });

    it("never counts a role labelled by its place as Strong or Good", () => {
        const unclear = { ...score(75), components: [{ key: "location" as const, label: "Location", detail: "", score: 0.5, unknown: true, reason: "remote_unplaced" as const }] };
        const outside = { ...score(55), outside: { home: ["Canada"], where: "United States", from: "resume" as const, total: 85 } };
        assert.deepEqual(countFitBands([unclear, outside, score(75)]), { strong: 0, good: 1, stretch: 2, unscored: 0 });
    });
});

describe("jobMatchesHubPack", () => {
    it("classifies remote, salary, ai, lead, fresh honestly", () => {
        const now = Date.parse("2026-09-24T12:00:00Z");
        assert.equal(
            jobMatchesHubPack(job({ id: "1", title: "Eng", work_type: "remote" }), "remote"),
            true,
        );
        assert.equal(
            jobMatchesHubPack(job({ id: "2", title: "Eng", salary_min: 120000 }), "salary"),
            true,
        );
        assert.equal(
            jobMatchesHubPack(job({ id: "3", title: "ML Engineer", tags: ["llm"] }), "ai"),
            true,
        );
        assert.equal(
            jobMatchesHubPack(job({ id: "4", title: "Staff Engineer" }), "lead"),
            true,
        );
        assert.equal(
            jobMatchesHubPack(
                job({ id: "5", title: "Eng", posted_ts: now - 2 * 24 * 60 * 60 * 1000 }),
                "fresh",
                now,
            ),
            true,
        );
        assert.equal(
            jobMatchesHubPack(
                job({ id: "6", title: "Eng", posted_ts: now - 40 * 24 * 60 * 60 * 1000 }),
                "fresh",
                now,
            ),
            false,
        );
    });
});

describe("resolveAllPackHubCounts", () => {
    it("resolves Strong·Good per pack from scored hits", () => {
        const scored = [
            {
                job: job({ id: "a", title: "ML Engineer", work_type: "remote", tags: ["ai"] }),
                score: score(90),
            },
            {
                job: job({ id: "b", title: "Remote PM", work_type: "remote", salary_min: 140000 }),
                score: score(70),
            },
            {
                job: job({ id: "c", title: "Staff Engineer", work_type: "hybrid" }),
                score: score(85),
            },
        ];
        const sources = resolveAllPackHubCounts({
            loading: false,
            probing: false,
            poolTotal: 508,
            scored,
        });
        const labels = formatAllPackHubLabels(sources);
        assert.match(labels.all ?? "", /Strong/);
        assert.match(labels.all ?? "", /~508 pool/);
        assert.ok(labels.remote);
        assert.ok(labels.lead);
        assert.ok(labels.ai);
    });

    it("shows loading on every pack before first scores", () => {
        const sources = resolveAllPackHubCounts({
            loading: true,
            probing: true,
            poolTotal: null,
            scored: [],
        });
        assert.equal(sources.all.kind, "loading");
        assert.equal(sources.remote.kind, "loading");
    });
});

describe("resolveHubRoleCountLabels", () => {
    it("shows a role count on every pack, counting Toronto like any other place", () => {
        const toronto = job({ id: "to", title: "Engineer", work_type: "remote" });
        toronto.location = "Toronto, ON";
        const scored = [
            {
                job: job({ id: "us", title: "ML Engineer", work_type: "remote", tags: ["ai"] }),
                score: score(90),
            },
            { job: toronto, score: score(80) },
        ];
        const pending = resolveHubRoleCountLabels({
            loading: true,
            probing: true,
            poolTotal: null,
            scored: [],
        });
        assert.equal(pending.all, "…");
        assert.equal(pending.remote, "…");

        const labels = resolveHubRoleCountLabels({
            loading: false,
            probing: false,
            poolTotal: 503,
            scored,
        });
        assert.equal(labels.all, "503 roles");
        assert.equal(labels.remote, "2 roles");
        assert.equal(labels.ai, "1 role");
        assert.equal(labels.good, "0 roles");
        assert.equal(formatHubRoleCount(1), "1 role");

        const partial = resolveHubRoleCountLabels({
            loading: false,
            probing: true,
            poolTotal: 503,
            scored,
        });
        assert.equal(partial.all, "503 roles");
        assert.equal(partial.remote, "2 roles");
        assert.equal(partial.good, "0 roles");
    });
});

describe("diffHubPackRemovals", () => {
    it("only reports real shrinks from prior known counts", () => {
        const prev = {
            updatedAt: "2026-09-23T12:00:00Z",
            packs: {
                all: { strong: 50, good: 20 },
                remote: { strong: 10, good: 5 },
                fresh: { strong: 3, good: 1 },
            },
        };
        const next = {
            all: { strong: 47, good: 20 },
            remote: { strong: 8, good: 5 },
            fresh: { strong: 3, good: 1 },
        };
        const removals = diffHubPackRemovals(prev, next);
        assert.equal(removals.length, 2);
        assert.equal(removals[0].packId, "all");
        assert.equal(removals[0].left, 3);
        assert.equal(removals[1].packId, "remote");
        assert.equal(removals[1].left, 2);
        assert.match(formatHubRemovalsLine(removals), /left/);
        assert.deepEqual(diffHubPackRemovals(null, next), []);
        assert.deepEqual(diffHubPackRemovals(prev, { all: { strong: 60, good: 20 } }), []);
    });
});

describe("packBandTotalsFromSources", () => {
    it("extracts band totals for memory", () => {
        const totals = packBandTotalsFromSources({
            all: { kind: "bands", strong: 10, good: 4, pool: 100 },
            remote: { kind: "omit" },
        });
        assert.deepEqual(totals.all, { strong: 10, good: 4 });
        assert.equal(totals.remote, undefined);
    });
});

describe("formatHubPackCorpusRoleLabels", () => {
    it("pack count label is not capped at the browse page size", () => {
        const browseSample = resolveBrowseHubRoleCountLabels({
            jobs: [job({ id: "1", title: "Eng", work_type: "remote" })],
            poolTotal: 100_000,
        });
        assert.equal(browseSample.remote, "1 role");

        const corpusLabels = formatHubPackCorpusRoleLabels({
            remote: { kind: "exact", value: 292_583 },
            all: { kind: "floor", value: 100_000 },
        });
        assert.equal(corpusLabels.remote, "292,583 roles");
        assert.equal(corpusLabels.all, "100,000+ roles");
        assert.notEqual(corpusLabels.remote, browseSample.remote);

        const saturatedNoFacet = formatHubPackCorpusRoleLabel({ kind: "floor", value: 100_000 });
        assert.equal(saturatedNoFacet, "100,000+ roles");
        assert.notEqual(saturatedNoFacet, "1 role");
        assert.notEqual(saturatedNoFacet, "20 roles");
    });

    it("keyword pack count is the largest phrase, not the page size or the sum", () => {
        const bound = keywordPackLowerBound([
            { kind: "exact", value: 1 },
            { kind: "exact", value: 6_150 },
            { kind: "exact", value: 1_749 },
        ]);
        assert.deepEqual(bound, { kind: "floor", value: 6_150 });
        assert.equal(formatHubPackCorpusRoleLabel(bound), "6,150+ roles");
        assert.notEqual(formatHubPackCorpusRoleLabel(bound), "1 role");
    });
});

describe("browse hub without a résumé", () => {
    const nowMs = Date.parse("2026-09-28T16:00:00Z");

    it("labels every pack from unscored jobs, Canada included", () => {
        const labels = resolveBrowseHubRoleCountLabels({
            nowMs,
            poolTotal: 1831,
            jobs: [
                job({
                    id: "us-1",
                    title: "Staff Machine Learning Engineer",
                    work_type: "remote",
                    salary_min: 180000,
                    posted_ts: nowMs - 60_000,
                    apply_url: "https://example.com/apply/us-1",
                    location_country: "United States",
                }),
                job({
                    id: "ca-1",
                    title: "Remote Machine Learning Engineer",
                    work_type: "remote",
                    salary_min: 120000,
                    posted_ts: nowMs - 60_000,
                    apply_url: "https://example.com/apply/ca-1",
                    location_country: "Canada",
                    location: "Toronto, ON",
                }),
            ],
        });
        assert.equal(labels.all, formatHubRoleCount(1831));
        assert.equal(labels.ai, "2 roles");
        assert.equal(labels.remote, "2 roles");
        assert.equal(labels.fresh, "2 roles");
        assert.equal(labels.salary, "2 roles");
        assert.equal(labels.apply, "2 roles");
        assert.equal(labels.lead, "1 role");
        assert.equal(labels.good, "0 roles");
        for (const label of Object.values(labels)) {
            assert.notEqual(label, "…");
            assert.doesNotMatch(label ?? "", /Strong|Good/);
        }
        assert.equal(formatBrowseHubCorpusLine(1831), `~${(1831).toLocaleString()} roles`);
        assert.doesNotMatch(formatBrowseHubCorpusLine(1831), /Strong/);
    });

    it("keeps an ellipsis until a browse sample exists", () => {
        const labels = resolveBrowseHubRoleCountLabels({ jobs: [], poolTotal: null });
        assert.equal(labels.remote, "…");
        assert.equal(labels.all, "…");
    });
});

describe("deckListLoading", () => {
    it("mounts a non-empty pack while fit is unresolved", () => {
        assert.equal(
            deckListLoading({
                proofLoading: false,
                fitResolving: true,
                loading: true,
                packCount: 12,
            }),
            false,
        );
    });

    it("stays a skeleton only while an empty pack is still fetching", () => {
        assert.equal(
            deckListLoading({
                proofLoading: false,
                fitResolving: true,
                loading: false,
                packCount: 0,
            }),
            true,
        );
        assert.equal(
            deckListLoading({
                proofLoading: false,
                fitResolving: false,
                loading: false,
                packCount: 0,
            }),
            false,
        );
    });
});

describe("resumeHubPackCounts", () => {
    // Every tile opens the résumé list, so a tile counts only rows of that list.
    const list = [
        job({ id: "r1", title: "Backend Engineer", work_type: "remote", salary_min: 120_000 }),
        job({ id: "r2", title: "Platform Engineer", work_type: "remote" }),
        job({ id: "o1", title: "Data Engineer", salary_max: 150_000 }),
    ];

    it("counts remote and salary inside the list, exactly once the list is whole", () => {
        const counts = resumeHubPackCounts({ listTotal: { kind: "exact", value: 3 }, listJobs: list });
        assert.deepEqual(counts.all, { kind: "exact", value: 3 });
        assert.deepEqual(counts.remote, { kind: "exact", value: 2 });
        assert.deepEqual(counts.salary, { kind: "exact", value: 2 });
        assert.deepEqual(counts.lead, { kind: "exact", value: 0 });
    });

    it("is a floor while only part of the list is fetched, and never exceeds the list", () => {
        const counts = resumeHubPackCounts({ listTotal: { kind: "exact", value: 40 }, listJobs: list });
        assert.deepEqual(counts.all, { kind: "exact", value: 40 });
        assert.deepEqual(counts.remote, { kind: "floor", value: 2 });
        assert.deepEqual(counts.fresh, { kind: "floor", value: 0 });
        // "2+" and "0+" say nothing about a pack that may hold many more: no count.
        assert.equal(formatHubPackCorpusRoleLabels(counts).remote, "");
        assert.equal(formatHubPackCorpusRoleLabels(counts).fresh, "");
    });

    it("shows a floor from ten up, and a small exact count as it is", () => {
        assert.equal(formatHubPackCorpusRoleLabel({ kind: "floor", value: 9 }), "");
        assert.equal(formatHubPackCorpusRoleLabel({ kind: "floor", value: 10 }), "10+ roles");
        assert.equal(formatHubPackCorpusRoleLabel({ kind: "exact", value: 0 }), "0 roles");
        assert.equal(formatHubPackCorpusRoleLabel({ kind: "exact", value: 1 }), "1 role");
    });

    it("is a floor when the list total itself is capped", () => {
        const counts = resumeHubPackCounts({ listTotal: { kind: "floor", value: 3 }, listJobs: list });
        assert.deepEqual(counts.salary, { kind: "floor", value: 2 });
    });

    it("counts what a deck lists of the rows it read: exact once every row was read, and 'all' is the listed count", () => {
        // 5 rows read, the deck lists the 3 above (two were left out): exact, not "3+" of 5.
        const counts = resumeHubPackCounts({ listTotal: { kind: "exact", value: 5 }, listJobs: list, rowsRead: 5 });
        assert.deepEqual(counts.all, { kind: "exact", value: 3 });
        assert.deepEqual(counts.remote, { kind: "exact", value: 2 });
        // Part of the search read: still a floor, and "all" is the search's total.
        const partial = resumeHubPackCounts({ listTotal: { kind: "exact", value: 400 }, listJobs: list, rowsRead: 150 });
        assert.deepEqual(partial.all, { kind: "exact", value: 400 });
        assert.deepEqual(partial.remote, { kind: "floor", value: 2 });
    });
});

describe("hubListedHits: a tile counts the roles the deck lists", () => {
    const NOW = Date.now();
    const posted = (daysAgo: number) => ({ posted_ts: NOW - daysAgo * 86_400_000, posted_at: new Date(NOW - daysAgo * 86_400_000).toISOString() });
    const strong = (id: string, extra: Partial<PublicJob> = {}) => ({
        job: job({ id, title: "Product Manager", ...posted(2), ...extra }),
        score: { total: 88, components: [], role: "own" } as MatchScore,
    });

    it("drops a role the deck leaves out (too old, another kind of job, Stretch) and one with no apply link (the deck drops it too)", () => {
        const hits = [
            strong("listed"),
            strong("old", posted(70)),
            { job: job({ id: "other", title: "Registered Nurse", ...posted(2) }), score: { total: 70, components: [], role: "off-target" } as MatchScore },
            { job: job({ id: "stretch", title: "Product Manager", ...posted(2) }), score: { total: 45, components: [], role: "own" } as MatchScore },
            strong("dead", { apply_url: "" }),
        ];
        const listed = hubListedHits(hits, NOW).map((h) => h.job.id);
        assert.ok(listed.includes("listed"));
        for (const gone of ["old", "other", "stretch", "dead"]) assert.equal(listed.includes(gone), false, gone);
    });

    it("the band counts a tile shows come from those roles only", () => {
        const hits = [strong("a"), strong("b"), strong("old", posted(70))];
        const sources = resolveAllPackHubCounts({ loading: false, probing: false, poolTotal: 3, scored: hits, nowMs: NOW });
        assert.deepEqual(sources.all, { kind: "bands", strong: 2, good: 0, total: 3, pool: 3 });
    });
});

describe("freshHubProbeMemo: going back to the hub repaints a finished probe", () => {
    const memo = { key: "pm\0canada", at: 1_000, complete: true };

    it("reuses the probe for the same résumé and pack while it is recent", () => {
        assert.equal(freshHubProbeMemo(memo, "pm\0canada", 1_000 + HUB_PROBE_MEMO_MS - 1), memo);
    });

    it("searches again for another résumé or pack, once it is old, or when a count was refused", () => {
        assert.equal(freshHubProbeMemo(memo, "csm\0canada", 2_000), null);
        assert.equal(freshHubProbeMemo(memo, "pm\0canada", 1_000 + HUB_PROBE_MEMO_MS), null);
        assert.equal(freshHubProbeMemo({ ...memo, complete: false }, "pm\0canada", 2_000), null);
        assert.equal(freshHubProbeMemo(null, "pm\0canada", 2_000), null);
    });
});

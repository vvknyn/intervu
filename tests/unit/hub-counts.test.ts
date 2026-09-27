import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    countFitBands,
    formatAllPackHubLabels,
    formatHubCorpusLine,
    formatHubCountLabel,
    formatHubRoleCount,
    resolveHubRoleCountLabels,
    packBandTotalsFromSources,
    resolveAllMatchesHubCount,
    resolveAllPackHubCounts,
} from "../../src/lib/jobs/for-you/hub-counts";
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
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
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
    it("shows a role count on every pack and keeps Toronto out of the sample", () => {
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
        assert.equal(labels.remote, "1 role");
        assert.equal(labels.ai, "1 role");
        assert.equal(labels.good, "0 roles");
        assert.equal(formatHubRoleCount(1), "1 role");
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareForYouKeys, deckListFor, forYouSortKey, orderForYouJobsByBand, matchBandSortKey } from "../../src/lib/jobs/for-you/band-order";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-10-15T12:00:00Z");

function job(id: string, title: string): PublicJob {
    return {
        id,
        title,
        company: "Acme",
        company_domain: "acme.com",
        apply_url: "https://example.com/apply",
        posted_at: "2026-10-13T12:00:00.000Z",
    } as PublicJob;
}

function score(total: number): MatchScore {
    return {
        total,
        components: [{ key: "relevance", label: "Relevance", detail: "test", score: total / 100 }],
    };
}

describe("matchBandSortKey", () => {
    it("orders Strong before Good before Stretch before unscored", () => {
        assert.ok(matchBandSortKey(score(85)) < matchBandSortKey(score(70)));
        assert.ok(matchBandSortKey(score(70)) < matchBandSortKey(score(40)));
        assert.ok(matchBandSortKey(score(40)) < matchBandSortKey(null));
    });

    it("uses the product boundaries: 80 Strong, 79 and 60 Good, 59 Stretch", () => {
        assert.equal(matchBandSortKey(score(80)), matchBandSortKey(score(100)));
        assert.ok(matchBandSortKey(score(80)) < matchBandSortKey(score(79)));
        assert.equal(matchBandSortKey(score(79)), matchBandSortKey(score(60)));
        assert.ok(matchBandSortKey(score(60)) < matchBandSortKey(score(59)));
    });
});

describe("orderForYouJobsByBand", () => {
    it("places Strong before Good regardless of input order, and leaves a Stretch role out", () => {
        const stretch = job("stretch", "Software Engineer");
        const good = job("good", "Software Engineer");
        const strong = job("strong", "Software Engineer");
        const ordered = orderForYouJobsByBand(
            [stretch, good, strong],
            (j) => {
                if (j.id === "strong") return score(88);
                if (j.id === "good") return score(72);
                return score(42);
            },
            NOW,
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["strong", "good"],
        );
    });

    it("keeps the incoming order among roles that fit exactly equally", () => {
        const a = job("a", "Role A");
        const b = job("b", "Role B");
        const c = job("c", "Role C");
        const ordered = orderForYouJobsByBand([a, b, c], () => score(81), NOW);
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["a", "b", "c"],
        );
    });

    it("does not order by title: the same fit reads the same whatever the roles are called", () => {
        const target = job("target", "Product Manager");
        const other = job("other", "Data Analyst");
        assert.deepEqual(orderForYouJobsByBand([other, target], () => score(90), NOW).map((j) => j.id), ["other", "target"]);
        assert.deepEqual(orderForYouJobsByBand([target, other], () => score(90), NOW).map((j) => j.id), ["target", "other"]);
    });

    it("a Strong role outranks a Good one even when the Good one carries the résumé's own title", () => {
        const targetGood = job("target-good", "Product Manager");
        const otherStrong = job("other-strong", "Data Analyst");
        const ordered = orderForYouJobsByBand(
            [targetGood, otherStrong],
            (j) => (j.id === "target-good" ? score(70) : score(90)),
            NOW,
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["other-strong", "target-good"],
        );
    });

    it("leaves a role with no score out of a list that asks for scores", () => {
        const unscored = job("none", "Software Engineer");
        const strong = job("strong", "Software Engineer");
        const ordered = orderForYouJobsByBand([unscored, strong], (j) => (j.id === "none" ? null : score(90)), NOW);
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["strong"],
        );
    });

    it("returns input order unchanged when getScore is null (no résumé path)", () => {
        const input = [job("b", "B"), job("a", "A")];
        const ordered = orderForYouJobsByBand(input, null, NOW);
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["b", "a"],
        );
    });

    it("deckListFor keeps relevant Stretch roles and unknown-country roles (including USD-paid unplaced remote) after Strong and Good fits", () => {
        const strong = job("strong", "Product Manager");
        const good = job("good", "Product Manager");
        const stretchOwn = job("stretch-own", "Product Manager, Agent");
        const unplacedUsd = job("unplaced-usd", "Product Manager");
        const unproven = job("unproven", "Commercial Finance Partner");
        const offTarget = job("off-target", "Senior Software Engineer");
        const scores = new Map<string, MatchScore>([
            ["strong", { ...score(88), role: "own" }],
            ["good", { ...score(72), role: "own" }],
            ["stretch-own", { ...score(58), role: "own", gaps: [{ kind: "skills", soft: true, text: "soft gap" }] }],
            [
                "unplaced-usd",
                {
                    total: 59,
                    role: "own",
                    outside: { home: ["Canada"], where: "the United States", currency: "USD", from: "resume", total: 80 },
                    components: [
                        { key: "relevance", label: "Relevance", detail: "test", score: 0.85 },
                        { key: "seniority", label: "Seniority", detail: "test", score: 1, reason: "level_fits" },
                        { key: "location", label: "Location", detail: "test", score: 0.65, reason: "remote_pay_abroad" },
                    ],
                },
            ],
            ["unproven", { ...score(55), role: "unverified", unproven: true }],
            ["off-target", { ...score(59), role: "off-target" }],
        ]);
        const { ranked, summary } = deckListFor(
            [unplacedUsd, offTarget, unproven, stretchOwn, good, strong],
            (j) => scores.get(j.id) ?? null,
            NOW,
        );
        assert.deepEqual(
            ranked.map((j) => j.id),
            ["strong", "good", "stretch-own", "unplaced-usd"],
        );
        assert.equal(summary.listed, 4);
    });

    it("forYouSortKey ranks own-role Stretch ahead of off-target Stretch on Search (sortByFit)", () => {
        const ownStretch = forYouSortKey({ ...score(59), role: "own" }, NOW - 8 * 86_400_000, NOW);
        const offTargetStretch = forYouSortKey({ ...score(59), role: "off-target" }, NOW - 2 * 86_400_000, NOW);
        assert.ok(compareForYouKeys(ownStretch, offTargetStretch) < 0);
    });
});


import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deckListFor, withRankedLowerLeftOut, type DeckLeftOutSummary } from "../../src/lib/jobs/for-you/band-order";
import { disclosureRows, formatDeckShowingLine, formatHubFitLine, formatLeftOutCount, leftOutTotal, rankedLowerTotal, rolesInList } from "../../src/lib/jobs/for-you/left-out-copy";
import { RankedListDisclosureView } from "../../src/components/jobs/for-you/RankedListDisclosure";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;

function job(id: string, ageDays = 3): PublicJob {
    return { id, title: "Product Manager", company: "Acme", company_domain: "acme.com", apply_url: "https://example.com/apply", posted_at: new Date(NOW - ageDays * DAY).toISOString() } as PublicJob;
}
function score(total: number, extra: Partial<MatchScore> = {}): MatchScore {
    return { total, role: "own", components: [{ key: "relevance", label: "Relevance", detail: "t", score: total / 100 }], ...extra };
}
const ABROAD = {
    components: [
        { key: "relevance", label: "Relevance", detail: "t", score: 0.9 },
        { key: "location", label: "Location", detail: "t", score: 0.1, reason: "remote_abroad" },
    ],
} as Partial<MatchScore>;

const JOBS: Record<string, { job: PublicJob; score: MatchScore }> = {
    strong: { job: job("strong"), score: score(90) },
    good: { job: job("good"), score: score(70) },
    stretch: { job: job("stretch"), score: score(50) },
    level: { job: job("level"), score: score(85, { newToManaging: true }) },
    requirement: { job: job("requirement"), score: score(80, { gaps: [{ kind: "years", text: "10 years" }] }) },
    other: { job: job("other"), score: score(75, { role: "off-target" }) },
    abroad: { job: job("abroad"), score: score(90, ABROAD) },
    german: { job: job("german"), score: score(90, { language: { posting: ["german"], yours: ["english"] } }) },
    old: { job: job("old", 60), score: score(90) },
};
const all = Object.values(JOBS).map((x) => x.job);
const scoreOf = (j: PublicJob) => JOBS[j.id]?.score ?? null;
const ids = (jobs: PublicJob[]) => jobs.map((j) => j.id);

describe("deckListFor ranks fit buckets lower instead of leaving them out", () => {
    const { ranked, lower, summary } = deckListFor(all, scoreOf, NOW);
    it("keeps the roles that fit in the bands and puts level, requirement, other-role and stretch after them", () => {
        assert.deepEqual(ids(ranked), ["strong", "good", "stretch"]);
        assert.deepEqual(new Set(ids(lower)), new Set(["level", "requirement", "other"]));
        assert.equal(lower.length, 3);
    });
    it("counts the tail by reason and no longer counts it as left out", () => {
        assert.deepEqual(summary.rankedLower, { level: 1, requirement: 1, "other-role": 1 });
        assert.equal(rankedLowerTotal(summary), 3);
        assert.equal(summary.byReason.level, undefined);
        assert.equal(summary.byReason["other-role"], undefined);
    });
    it("still removes the hard buckets: old, abroad, language", () => {
        assert.deepEqual(summary.byReason, { old: 1, abroad: 1, language: 1 });
        assert.equal(leftOutTotal(summary), 3);
        assert.ok(![...ids(ranked), ...ids(lower)].some((id) => ["old", "abroad", "german"].includes(id)));
    });
    it("orders a list whose only fits are weaker the same way: nothing stretch-only is dropped", () => {
        const only = deckListFor([JOBS.stretch!.job, JOBS.level!.job], scoreOf, NOW);
        assert.deepEqual(ids(only.ranked), ["stretch"]);
        assert.deepEqual(ids(only.lower), ["level"]);
    });
    it("includeAbroad and includeOlder move those hard buckets into the tail, not the bands", () => {
        const abroad = deckListFor(all, scoreOf, NOW, { abroad: true });
        assert.ok(ids(abroad.lower).includes("abroad"));
        assert.equal(abroad.summary.byReason.abroad, undefined);
        assert.equal(abroad.summary.rankedLower?.abroad, 1);
        const older = deckListFor(all, scoreOf, NOW, { older: true });
        assert.ok(ids(older.lower).includes("old"));
        assert.ok(!ids(older.ranked).includes("old"));
        assert.equal(older.summary.byReason.old, undefined);
    });
    it("an older role that is also abroad stays out when only older is included", () => {
        const both = job("old-abroad", 60);
        const r = deckListFor([JOBS.strong!.job, both], (j) => (j.id === "old-abroad" ? score(90, ABROAD) : scoreOf(j)), NOW, { older: true });
        assert.deepEqual(ids(r.lower), []);
        assert.equal(r.summary.byReason.old, 1);
    });
    it("the agent's list still holds only roles that fit, with the tail counted as left out", () => {
        const agent = withRankedLowerLeftOut(deckListFor(all, scoreOf, NOW));
        assert.deepEqual(ids(agent.ranked), ["strong", "good", "stretch"]);
        assert.equal(agent.summary.rankedLower, undefined);
        assert.deepEqual(agent.summary.byReason, { old: 1, abroad: 1, language: 1, level: 1, requirement: 1, "other-role": 1 });
    });
});

describe("when nothing fits, ranking still lists everything the search found", () => {
    const WEAK = score(50);
    // Five closest (Stretch) first, then every role a hard cut would drop: abroad, old, in another language.
    const mixed = (n: number) => {
        const jobs: Record<string, { job: PublicJob; score: MatchScore }> = {};
        for (let i = 0; i < n; i++) {
            const kind = i < 5 ? "stretch" : i % 3 === 0 ? "abroad" : i % 3 === 1 ? "old" : "german";
            const s = kind === "abroad" ? score(50, ABROAD) : kind === "german" ? score(50, { language: { posting: ["german"], yours: ["english"] } }) : WEAK;
            jobs[`r${i}`] = { job: job(`r${i}`, kind === "old" ? 60 : 3), score: s };
        }
        return jobs;
    };
    it("19 results, 5 closest: 5 ranked, 14 ranked lower, none left out", () => {
        const set = mixed(19);
        const r = deckListFor(Object.values(set).map((x) => x.job), (j) => set[j.id]!.score, NOW);
        assert.equal(r.ranked.length, 5);
        assert.equal(r.lower.length, 14);
        assert.equal(r.summary.near, true);
        assert.equal(rankedLowerTotal(r.summary), 14);
        assert.equal(leftOutTotal(r.summary), 0);
        assert.equal(r.summary.listed + rankedLowerTotal(r.summary), 19);
    });
    it("fewer results than the cap: all ranked, nothing lower", () => {
        const set = mixed(3);
        const r = deckListFor(Object.values(set).map((x) => x.job), (j) => set[j.id]!.score, NOW);
        assert.equal(r.ranked.length, 3);
        assert.equal(r.lower.length, 0);
    });
    it("the agent's list is unchanged: the closest only, the rest counted as left out", () => {
        const set = mixed(19);
        const agent = withRankedLowerLeftOut(deckListFor(Object.values(set).map((x) => x.job), (j) => set[j.id]!.score, NOW));
        assert.equal(agent.ranked.length, 5);
        assert.deepEqual(agent.summary.byReason, { abroad: 5, old: 4, language: 5 });
        assert.equal(agent.summary.rankedLower, undefined);
    });
});

const SUMMARY: DeckLeftOutSummary = {
    considered: 290,
    found: 368,
    listed: 114,
    byReason: { old: 48, language: 2, abroad: 2, tracked: 2, closed: 1 },
    languages: { german: 1, french: 1 },
    rankedLower: { "other-role": 89, requirement: 15, level: 9, stretch: 9 },
};

describe("the one disclosure line", () => {
    it("counts only the roles the rules left out", () => {
        assert.equal(formatLeftOutCount(SUMMARY), "55 left out");
        assert.equal(formatLeftOutCount({ considered: 100, listed: 90, byReason: { old: 10 } }), "10 left out");
    });
    it("is absent when nothing was left out, whatever else the list holds", () => {
        assert.equal(formatLeftOutCount({ considered: 120, found: 300, listed: 100, byReason: {}, rankedLower: { stretch: 20 } }), null);
        assert.equal(formatLeftOutCount({ considered: 20, listed: 20, byReason: {} }), null);
        assert.equal(formatLeftOutCount(null), null);
    });
    it("the headline counts the roles it leads with and the ones ranked lower, and says the same for every kind", () => {
        assert.equal(rolesInList(SUMMARY), 236);
        assert.equal(formatHubFitLine(SUMMARY), "236 roles · ranked by fit");
        for (const kind of [{ near: true }, { older: true }, { near: true, older: true }] as const) assert.equal(formatHubFitLine({ ...SUMMARY, ...kind }), "236 roles · ranked by fit");
        assert.equal(formatDeckShowingLine(114), "114 roles · ranked by fit");
        assert.equal(formatDeckShowingLine(1), "1 role · ranked by fit");
    });
});

describe("the disclosure rows", () => {
    const rows = disclosureRows(SUMMARY, 94);
    it("lists employers, then left-out buckets, only for non-zero buckets, and no ranked-lower row", () => {
        assert.equal(rows[0]!.reason, "236 roles at 94 employers");
        assert.deepEqual(rows.filter((r) => r.group === "left-out").map((r) => r.key), ["language-german", "language-french", "abroad", "old", "tracked", "closed"]);
        assert.equal(rows.length, 7);
        assert.ok(!rows.some((r) => r.key.startsWith("lower-")));
    });
    it("gives each bucket its action", () => {
        const by = Object.fromEntries(rows.map((r) => [r.key, r.action]));
        assert.deepEqual(by.old, { kind: "include", reason: "old" });
        assert.deepEqual(by.abroad, { kind: "include", reason: "abroad" });
        assert.deepEqual(by["language-german"], { kind: "include", reason: "language", language: "german" });
        assert.deepEqual(by.tracked, { kind: "tracker" });
        assert.equal(by.closed, undefined);
    });
    it("drops zero buckets and the employers row when every role is its own employer", () => {
        const few = disclosureRows({ considered: 10, listed: 8, byReason: { old: 2 } }, 8);
        assert.deepEqual(few.map((r) => r.key), ["old"]);
    });
    it("after an include the bucket is ranked lower, which has no row", () => {
        assert.deepEqual(disclosureRows({ considered: 10, listed: 5, byReason: {}, rankedLower: { old: 3 } }), []);
    });
});

describe("RankedListDisclosureView", () => {
    const render = (open: boolean) =>
        renderToStaticMarkup(
            React.createElement(RankedListDisclosureView, { line: formatLeftOutCount(SUMMARY)!, rows: disclosureRows(SUMMARY, 94), open, onToggle() {}, onAction() {}, footer: React.createElement("span", null, "Postings in footer") }),
        );
    it("is one collapsed line by default", () => {
        const html = render(false);
        assert.match(html, /aria-expanded="false"/);
        assert.match(html, /55 left out/);
        assert.doesNotMatch(html, /data-testid="ranked-disclosure-panel"|Include|Postings in footer/);
    });
    it("opens to a row per non-zero bucket, an action beside each, and the languages last", () => {
        const html = render(true);
        assert.match(html, /aria-expanded="true"/);
        assert.match(html, /48 · posted over 30 days ago/);
        assert.match(html, /1 · written in German/);
        assert.match(html, /View in tracker/);
        assert.doesNotMatch(html, /Jump/);
        assert.equal((html.match(/>Include</g) ?? []).length, 4);
        assert.ok(html.indexOf("Postings in footer") > html.indexOf("ranked-row-closed"));
        assert.doesNotMatch(html, /ranked-row-unplaced|ranked-row-level"/);
    });
});

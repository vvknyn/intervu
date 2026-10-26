import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deckListFor, withListRemovals, type DeckLeftOutSummary } from "../../src/lib/jobs/for-you/band-order";
import { collapseByEmployer, slotOpenings } from "../../src/lib/jobs/for-you/employer-slot";
import { deckListKind, formatHubFitLine, formatLeftOutCount, levelLeftOut, listNoticeLine, rankedLowerTotal, rolesInList } from "../../src/lib/jobs/for-you/left-out-copy";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;

const mk = (id: string, employer: string, ageDays = 3): PublicJob =>
    ({ id, title: "Product Manager", company: employer, company_domain: `${employer}.com`, apply_url: "https://example.com/apply", posted_at: new Date(NOW - ageDays * DAY).toISOString() }) as PublicJob;
const score = (total: number, extra: Partial<MatchScore> = {}): MatchScore => ({ total, role: "own", components: [{ key: "relevance", label: "Relevance", detail: "t", score: total / 100 }], ...extra });
const ABROAD = { components: [{ key: "relevance", label: "Relevance", detail: "t", score: 0.9 }, { key: "location", label: "Location", detail: "t", score: 0.1, reason: "remote_abroad" }] } as Partial<MatchScore>;
const GERMAN = { language: { posting: ["german"], yours: ["english"] } } as Partial<MatchScore>;
const LEVEL = { newToManaging: true } as Partial<MatchScore>;

type Row = { job: PublicJob; score: MatchScore };
const rows = (spec: [employer: string, count: number, make: (employer: string, i: number) => Row][]): Row[] =>
    spec.flatMap(([employer, count, make]) => Array.from({ length: count }, (_, i) => make(employer, i)));
const fit = (e: string, i: number): Row => ({ job: mk(`${e}-fit-${i}`, e), score: score(90) });
const lowerLevel = (e: string, i: number): Row => ({ job: mk(`${e}-lvl-${i}`, e), score: score(85, LEVEL) });
const old = (e: string, i: number): Row => ({ job: mk(`${e}-old-${i}`, e, 60), score: score(90) });
const weak = (e: string, i: number): Row => ({ job: mk(`${e}-weak-${i}`, e), score: score(50) });
const abroad = (e: string, i: number): Row => ({ job: mk(`${e}-abr-${i}`, e), score: score(50, ABROAD) });
const oldAbroad = (e: string, i: number): Row => ({ job: mk(`${e}-oab-${i}`, e, 60), score: score(50, ABROAD) });
const german = (e: string, i: number): Row => ({ job: mk(`${e}-ger-${i}`, e), score: score(50, GERMAN) });

/** The list the page builds: `deckListFor`, the tracker/closed removals, then one slot per employer. */
function build(set: Row[], removed: { closed?: number; tracked?: number } = {}) {
    const byId = new Map(set.map((r) => [r.job.id, r.score] as const));
    const { ranked, lower, summary } = deckListFor(set.map((r) => r.job), (j) => byId.get(j.id) ?? null, NOW);
    const slots = collapseByEmployer([...ranked, ...lower], (j) => j);
    return { slots, summary: withListRemovals(summary, removed) as DeckLeftOutSummary };
}
const reachable = (slots: ReturnType<typeof build>["slots"]) => slots.reduce((n, s) => n + 1 + s.more.length + s.hidden, 0);

describe("the headline number is the roles the list can show", () => {
    it("fit list: cards, roles behind 'N more at X' (past the cap too), ranked lower; old roles are left out", () => {
        const set = rows([["acme", 6, fit], ["beta", 2, fit], ["gamma", 1, fit], ["acme", 2, lowerLevel], ["delta", 3, lowerLevel], ["omega", 4, old]]);
        const { slots, summary } = build(set);
        assert.equal(deckListKind(summary), "fit");
        assert.equal(rolesInList(summary), 14);
        assert.equal(rolesInList(summary), reachable(slots));
        assert.equal(rolesInList(summary), slots.reduce((n, s) => n + slotOpenings(s), 0));
        assert.ok(slots.some((s) => s.hidden > 0), "an employer past the slot cap is in the fixture");
        assert.equal(formatHubFitLine(summary), "14 roles · ranked by fit");
        assert.equal(formatLeftOutCount(summary), "4 left out");
    });

    it("nothing fits: the closest lead, every other scored role ranks lower, so rule cuts merge into the count and only closed, tracked and unscored are left out", () => {
        const set = rows([["acme", 2, weak], ["beta", 1, weak], ["acme", 2, abroad], ["gamma", 3, german], ["delta", 2, oldAbroad], ["zeta", 1, lowerLevel]]);
        const { slots, summary } = build(set, { closed: 2, tracked: 1 });
        assert.equal(deckListKind(summary), "near");
        assert.equal(summary.listed, 3);
        assert.equal(rolesInList(summary), 11, "every scored role the list read, not only the closest");
        assert.equal(rolesInList(summary), reachable(slots));
        assert.deepEqual(summary.byReason, { closed: 2, tracked: 1 });
        assert.equal(formatHubFitLine(summary), "11 roles · ranked by fit");
        assert.equal(formatLeftOutCount(summary), "3 left out");
    });

    it("only older roles fit: the older roles lead, the rest rank lower", () => {
        const set = rows([["acme", 2, old], ["beta", 1, old], ["gamma", 2, lowerLevel]]);
        const { slots, summary } = build(set);
        assert.equal(deckListKind(summary), "older");
        assert.equal(rolesInList(summary), 5);
        assert.equal(rolesInList(summary), reachable(slots));
        assert.equal(formatHubFitLine(summary), "5 roles · ranked by fit");
    });

    it("nothing ranks lower: the number is the cards and what rides behind them", () => {
        const set = rows([["acme", 3, fit], ["beta", 1, fit], ["gamma", 1, fit], ["omega", 2, old]]);
        const { slots, summary } = build(set);
        assert.equal(summary.rankedLower, undefined);
        assert.equal(rolesInList(summary), 5);
        assert.equal(rolesInList(summary), reachable(slots));
        assert.equal(formatHubFitLine(summary), "5 roles · ranked by fit");
    });

    it("nothing left out: no count line, however many roles rank lower", () => {
        const { summary } = build(rows([["acme", 2, fit], ["beta", 3, lowerLevel]]));
        assert.equal(rolesInList(summary), 5);
        assert.equal(formatLeftOutCount(summary), null);
    });
});

describe("the count line claims nothing about the ranked-lower tail; the kind's fact is the lead group's own notice", () => {
    const CLAIMS_OF_THE_LEAD = /closest|weaker|posted over|fit your résumé|\bfits\b/;
    const NEWER = (e: string, i: number): Row => ({ job: mk(`${e}-new-${i}`, e, 5), score: score(50, ABROAD) });
    const cases: [kind: string, set: Row[], tailHolds: string][] = [
        ["near", rows([["acme", 2, weak], ["beta", 2, abroad]]), "an abroad role"],
        ["older-near", rows([["acme", 2, (e, i) => ({ job: mk(`${e}-oldweak-${i}`, e, 60), score: score(50) })], ["beta", 2, NEWER]]), "a 5-day-old role"],
        ["older", rows([["acme", 2, old], ["beta", 2, lowerLevel]]), "a weaker-fit role"],
    ];
    for (const [kind, set, tailHolds] of cases) {
        it(`${kind}: the tail holds ${tailHolds} and the count line says only "N roles · ranked by fit"`, () => {
            const { summary } = build(set);
            assert.equal(deckListKind(summary), kind);
            assert.ok(rankedLowerTotal(summary) > 0, "the tail is not empty");
            const line = formatHubFitLine(summary)!;
            assert.equal(line, `${rolesInList(summary)} roles · ranked by fit`);
            assert.doesNotMatch(line, CLAIMS_OF_THE_LEAD);
            const notice = listNoticeLine(kind as ReturnType<typeof deckListKind>)!;
            assert.match(notice.text, /at the top/, "worded to name the lead group only");
        });
    }
    it("a list of roles that fit has no kind notice", () => assert.equal(listNoticeLine("fit"), null));
});

describe("a list that leads with nothing still counts the roles it shows", () => {
    it("every role ranks lower (all abroad): the count is the roles below the divider, not 'No role fits'", () => {
        const { slots, summary } = build(rows([["acme", 3, abroad], ["beta", 2, abroad]]));
        assert.equal(summary.listed, 0);
        assert.equal(rolesInList(summary), 5);
        assert.equal(rolesInList(summary), reachable(slots));
        assert.equal(formatHubFitLine(summary), "5 roles · ranked by fit");
    });
    it("a list that read roles and shows none says so; one that read nothing has no line", () => {
        assert.equal(formatHubFitLine({ considered: 4, listed: 0, byReason: { closed: 4 } }), "No role fits your résumé yet");
        assert.equal(formatHubFitLine({ considered: 0, listed: 0, byReason: {} }), null);
    });
});

describe("a plain search's roles past the person's level read as the same 'N left out'", () => {
    it("counts them in one line with a reason row, and says nothing when none were cut", () => {
        const out = levelLeftOut(7)!;
        assert.equal(out.line, "7 left out");
        assert.deepEqual(out.rows.map((r) => [r.count, r.reason, r.action]), [[7, "above your level", undefined]]);
        assert.equal(levelLeftOut(1)!.line, "1 left out");
        assert.equal(levelLeftOut(0), null);
    });
});

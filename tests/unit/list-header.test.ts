import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
    HEADER_BAND_PRIORITY,
    HEADER_NOTE_PRIORITY,
    LIST_HEADER_BUDGET,
    LIST_HEADER_LINES,
    listHeaderPlan,
    pickHeaderBand,
    pickHeaderNote,
    type HeaderBand,
    type HeaderNote,
    type ListHeaderState,
} from "../../src/lib/jobs/list-header";

const PAGE = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");

const bools = [false, true] as const;
const noteSets: HeaderNote[][] = [[], ["widened"], ["degraded", "unmatched"], [...HEADER_NOTE_PRIORITY]];
const bands: (HeaderBand | null)[] = [null, ...HEADER_BAND_PRIORITY];

/** Every combination of the facts the header reads: signed in or out, ranked or not, at rest or searching, filtered, zero or many rows. */
function* everyState(): Generator<ListHeaderState> {
    for (const homeShown of bools)
        for (const atRest of bools)
            for (const signedIn of bools)
                for (const ranked of bools)
                    for (const rowsShown of bools)
                        for (const band of bands)
                            for (const status of bools)
                                for (const scope of bools)
                                    for (const disclosure of bools)
                                        for (const notes of noteSets)
                                            yield { homeShown, atRest, signedIn, ranked, rowsShown, band, status, scope, notes, disclosure };
}

function base(): ListHeaderState {
    return { homeShown: true, atRest: false, signedIn: true, ranked: true, rowsShown: true, band: null, status: false, scope: false, notes: [], disclosure: false };
}

describe("the list header budget", () => {
    it("never holds more than the budget, in any state", () => {
        let states = 0;
        for (const state of everyState()) {
            states++;
            const { lines } = listHeaderPlan(state);
            assert.ok(lines.length <= LIST_HEADER_BUDGET, `${JSON.stringify(state)} -> ${lines.join(",")}`);
        }
        assert.ok(states > 1000, "the walk covers every combination");
        assert.equal(LIST_HEADER_BUDGET, 5, "a sixth line is a decision, not a drift: change the budget and say why in the PR");
        assert.deepEqual([...LIST_HEADER_LINES], ["band", "note", "status", "scope", "disclosure"]);
    });

    it("holds each line at most once, and only the lines it names", () => {
        for (const state of everyState()) {
            const { lines } = listHeaderPlan(state);
            assert.equal(new Set(lines).size, lines.length);
            for (const line of lines) assert.ok(LIST_HEADER_LINES.includes(line));
        }
    });

    it("shows one band above the list, the first that applies: the address prompt, the résumé invite, the Chrome tile, the board's new roles", () => {
        assert.equal(pickHeaderBand({ prompt: false, resume: false, extension: false, visit: false }), null);
        assert.equal(pickHeaderBand({ prompt: true, resume: true, extension: true, visit: true }), "prompt");
        assert.equal(pickHeaderBand({ prompt: false, resume: true, extension: true, visit: true }), "resume");
        assert.equal(pickHeaderBand({ prompt: false, resume: false, extension: true, visit: true }), "extension");
        assert.equal(pickHeaderBand({ prompt: false, resume: false, extension: false, visit: true }), "visit");
        for (const state of everyState()) assert.ok(listHeaderPlan(state).lines.filter((l) => l === "band").length <= 1);
    });

    it("shows one note about how the search was read, the highest priority", () => {
        assert.equal(pickHeaderNote([]), null);
        assert.equal(pickHeaderNote(["elsewhere", "widened", "understood"]), "widened");
        assert.equal(pickHeaderNote([...HEADER_NOTE_PRIORITY].reverse()), "degraded");
        for (const state of everyState()) {
            const plan = listHeaderPlan(state);
            assert.equal(plan.lines.filter((l) => l === "note").length, plan.note ? 1 : 0);
        }
    });

    it("says nothing above rows that are not on screen", () => {
        for (const state of everyState()) {
            if (state.rowsShown) continue;
            assert.deepEqual(listHeaderPlan(state).lines, [], JSON.stringify(state));
        }
    });

    it("keeps the lines in one order: band, note, status, controls, disclosure", () => {
        const all = listHeaderPlan({ ...base(), band: "extension", status: true, scope: true, notes: ["widened"], disclosure: true });
        assert.deepEqual(all.lines, ["band", "note", "status", "scope", "disclosure"]);
    });
});

describe("entry points go once there is a list (the class behind the phone screenshot of 2026-11-01)", () => {
    it("does not show browse-by-field above a résumé-ranked list, in any state", () => {
        for (const state of everyState()) {
            if (state.ranked) assert.equal(listHeaderPlan(state).fieldChips, false, JSON.stringify(state));
        }
    });

    it("does not show the hero above a signed-in account's résumé-ranked list, in any state", () => {
        for (const state of everyState()) {
            if (state.ranked && state.signedIn) assert.equal(listHeaderPlan(state).hero, false, JSON.stringify(state));
        }
    });

    it("keeps the front door for someone with no list: the hero and browse-by-field at rest", () => {
        const guest = listHeaderPlan({ ...base(), atRest: true, signedIn: false, ranked: false });
        assert.equal(guest.hero, true);
        assert.equal(guest.fieldChips, true);
        const signedInNoResume = listHeaderPlan({ ...base(), atRest: true, signedIn: true, ranked: false });
        assert.equal(signedInNoResume.hero, true);
        assert.equal(signedInNoResume.fieldChips, true);
    });

    it("keeps a guest's hero (the privacy line is said on the first screen) over their own top matches", () => {
        assert.equal(listHeaderPlan({ ...base(), atRest: true, signedIn: false, ranked: true }).hero, true);
    });

    it("never shows an entry point once the person has searched, or while the page holds its place", () => {
        for (const state of everyState()) {
            const plan = listHeaderPlan(state);
            if (!state.atRest || !state.homeShown) {
                assert.equal(plan.hero, false);
                assert.equal(plan.fieldChips, false);
            }
        }
    });
});

describe("JobsContent renders the header only through the plan", () => {
    // The header is two stretches of the list column: above the panel switch (band, note) and, in the list branch of it,
    // the status row, the level note and the disclosure. The panels the switch shows in place of a list (the ask, an error,
    // the empty state) are not header lines.
    const start = PAGE.indexOf('data-testid="list-header"');
    const switchAt = PAGE.indexOf('{resultsPanel === "serp-ask" ? (');
    const listBranch = PAGE.indexOf("{!isSerpAsk && (", switchAt);
    const end = PAGE.indexOf('id="jobs-results-list"');
    const headerSource = () => PAGE.slice(start, switchAt) + PAGE.slice(listBranch, end);

    it("mounts the hero, browse-by-field and the band on the plan, not on their own conditions", () => {
        assert.match(PAGE, /const listHeader = listHeaderPlan\(/);
        assert.match(PAGE, /\{listHeader\.hero \? \(/);
        assert.match(PAGE, /\{listHeader\.fieldChips && \(\s*<div className=\{cappedContentClass\}>\s*<FrontDoorFieldLinks/);
        assert.equal(PAGE.split("<ExtensionTile").length - 1, 1);
        assert.equal(PAGE.split("<BoardVisitBanner").length - 1, 1);
        assert.match(PAGE, /\{headerBand === "visit" && <BoardVisitBanner/);
        assert.match(PAGE, /const promoBand = pickPromoBand\(\{ resume: headerBand === "resume", extension: headerBand === "extension" \}\);/);
    });

    it("tags every text block of the header region with the line it is, from the plan's own list", () => {
        assert.ok(start > 0 && switchAt > start && listBranch > switchAt && end > listBranch, "the header region is marked and precedes the list");
        const region = headerSource();
        const tagged = [...region.matchAll(/data-header-line="([a-z-]+)"/g)].map((m) => m[1]);
        assert.ok(tagged.length >= 4, "the header's lines are tagged");
        for (const line of tagged) assert.ok((LIST_HEADER_LINES as readonly string[]).includes(line), `unknown header line "${line}"`);
        // A paragraph in the region that is not a tagged line is a line the plan does not know: it would creep back.
        const paragraphs = [...region.matchAll(/<p\b[^>]*>/g)].map((m) => m[0]);
        for (const p of paragraphs) assert.match(p, /data-header-line=/, `an untagged paragraph in the list header: ${p.slice(0, 120)}`);
    });

    it("says each of the notes once, behind the one-note rule", () => {
        const region = headerSource();
        for (const note of HEADER_NOTE_PRIORITY) assert.match(region, new RegExp(`headerNote === "${note}"`), `${note} renders only when it is the picked note`);
    });

    it("says what is new, and the way to change the résumé, on the status line rather than on lines of their own", () => {
        const region = headerSource();
        const status = region.slice(region.indexOf('{listHeader.lines.includes("status") && ('), region.indexOf('data-header-line="scope"'));
        for (const id of ["result-line", "list-new-since", "beyond-window-show-all"]) assert.match(status, new RegExp(`data-testid="${id}"`), `${id} is on the status line`);
        assert.match(status, /resumeStripEl,/, "the way to change the résumé is an item of the status line");
        assert.match(PAGE, /const resumeStripEl = showResumeStrip \? \(\s*<span data-testid="resume-read-strip"/);
        // Where the list's own line is not shown (loading, empty, an error) the Edit link stands alone, so it is never out of reach.
        assert.match(region, /\{resumeStripEl && !listPanelShown && \(\s*<p data-header-line="status"/);
        assert.doesNotMatch(region, /Ranked by your résumé|some may already be filled/i, "the basis is said once, by the count and the Edit link");
    });
});

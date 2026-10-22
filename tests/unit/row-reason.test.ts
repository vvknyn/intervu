import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROW_REASON_MAX, rowReasonLine } from "../../src/lib/jobs/for-you/row-reason";
import { MATCH_COMPONENT_KEYS, type MatchComponent, type MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

const job = { id: "1", title: "Account Executive" } as PublicJob;
const resume = { profile: { profession: "Senior Product Manager" }, experience: [{ role: "Senior Product Manager" }] } as ResumeData;

// One realistic detail per key, with the long " — verdict" tail each generator appends.
const DETAIL: Record<(typeof MATCH_COMPONENT_KEYS)[number], string> = {
    relevance: "7 of 12 terms this role names",
    seniority: "senior role — matches your senior level (10 years of experience)",
    location: "remote — matches your remote-only preference and the long tail that follows it",
};

const score = (c: Partial<MatchComponent> & Pick<MatchComponent, "key">): MatchScore =>
    ({ total: 80, components: [{ label: c.key[0].toUpperCase() + c.key.slice(1), detail: DETAIL[c.key], score: 0.9, ...c }] }) as MatchScore;

describe("rowReasonLine (compact row form)", () => {
    for (const key of MATCH_COMPONENT_KEYS) {
        it(`${key}: lead clause only, within the bound`, () => {
            const line = rowReasonLine(job, score({ key }), null)!;
            assert.ok(line.length <= ROW_REASON_MAX, line);
            assert.ok(!line.includes("("), line);
            assert.ok(line.startsWith(key[0].toUpperCase() + key.slice(1) + ": "), line);
        });
    }

    it("keeps the fit claim when it fits (parenthetical dropped), falls back to the lead clause when it overflows", () => {
        assert.equal(rowReasonLine(job, score({ key: "seniority" }), null), "Seniority: senior role — matches your senior level");
        assert.equal(rowReasonLine(job, score({ key: "location" }), null), "Location: remote");
    });

    it("title overlap is compact and bounded, even for a very long résumé role", () => {
        const pm = { id: "2", title: "Senior Product Manager" } as PublicJob;
        assert.equal(rowReasonLine(pm, score({ key: "relevance" }), resume), "Title overlap · Senior Product Manager");
        const long = { profile: {}, experience: [{ role: "Senior Product Manager " + "Platform ".repeat(12) }] } as ResumeData;
        assert.ok(rowReasonLine(pm, score({ key: "relevance" }), long)!.length <= ROW_REASON_MAX);
    });

    it("says nothing when no component is strong or the fit is unknown", () => {
        assert.equal(rowReasonLine(job, score({ key: "seniority", score: 0.5 }), null), null);
        assert.equal(rowReasonLine(job, score({ key: "seniority", unknown: true }), null), null);
        assert.equal(rowReasonLine(job, null, null), null);
    });
});

describe("row text is never a one-line ellipsis", () => {
    const card = readFileSync(path.join(process.cwd(), "src/components/jobs/JobCard.tsx"), "utf8");
    const tag = (id: string) => card.match(new RegExp(`data-testid="${id}"[^>]*>`))?.[0] ?? "";
    for (const id of ["row-fit-reason", "job-row-meta"]) {
        it(`${id} clamps to 2 lines`, () => assert.match(tag(id) || card.slice(card.indexOf(id), card.indexOf(id) + 400), /line-clamp-2/));
    }
    it("meta line carries the full string in title", () => assert.match(card.slice(card.indexOf('data-testid="job-row-meta"') - 20, card.indexOf('data-testid="job-row-meta"') + 300), /title=/));
});

describe("toolbar below @2xl is one scrolling row", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/jobs/JobsContent.tsx"), "utf8");
    const at = (id: string) => page.slice(page.indexOf(`data-testid="${id}"`), page.indexOf(`data-testid="${id}"`) + 700);
    it("wrapper scrolls sideways and only blocks at @2xl", () => {
        const w = at("jobs-toolbar-rows");
        assert.match(w, /overflow-x-auto/);
        assert.match(w, /@2xl:block/);
    });
    for (const id of ["jobs-toolbar-scroller", "active-filter-row"]) {
        it(`${id} does not wrap below @2xl`, () => {
            const cls = at(id);
            assert.match(cls, /shrink-0/);
            assert.ok(!/(^|[\s"])flex-wrap/.test(cls.slice(0, 400)), "bare flex-wrap would wrap on a phone");
            assert.match(cls, /@2xl:[^"]*flex-wrap|@2xl:flex-wrap/);
        });
    }
});

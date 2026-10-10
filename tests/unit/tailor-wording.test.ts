import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    equivalentWords,
    postingAcronyms,
    readPostingWording,
    rewordLine,
    spellingKey,
    type RewordContext,
} from "../../src/lib/local-ai/tailor-wording";

/**
 * The rules that reword a résumé line in a posting's words without adding a
 * claim (src/lib/local-ai/tailor-wording.ts). Vivek 2026-10-10: tailoring
 * "only the skill section is tweaked ... there could be other updates like
 * wordings for their job experiences".
 */

const ctx = (over: Partial<RewordContext> = {}): RewordContext => ({
    roleOpeners: new Set(),
    acronymsDone: new Set(),
    verbs: true,
    ...over,
});

const reword = (line: string, posting: string, over: Partial<RewordContext> = {}) =>
    rewordLine(line, readPostingWording(posting), ctx(over)).after;

describe("spellingKey: one key per word, however it is spelled", () => {
    it("joins British and American spellings, hyphens, dots and case", () => {
        for (const [a, b] of [
            ["organisation", "organization"],
            ["analysed", "analyzed"],
            ["counselling", "counseling"],
            ["behavioural", "behavioral"],
            ["centre", "center"],
            ["modelling", "modeling"],
            ["catalogue", "catalog"],
            ["paediatric", "pediatric"],
            ["programme", "program"],
            ["licence", "license"],
            ["e-commerce", "ecommerce"],
            ["Node.js", "nodejs"],
            ["JavaScript", "javascript"],
        ]) {
            assert.equal(spellingKey(a), spellingKey(b), `${a} / ${b}`);
        }
    });

    it("keeps different words apart", () => {
        for (const [a, b] of [
            ["filled", "filed"],
            ["four", "for"],
            ["your", "yor"],
            ["filling", "filing"],
        ]) {
            assert.notEqual(spellingKey(a), spellingKey(b), `${a} / ${b}`);
        }
    });
});

describe("rewordLine: action verbs", () => {
    it("swaps the opening verb for the posting's near-synonym, in the line's own tense", () => {
        assert.equal(reword("Charted all assessments in Epic.", "Document assessments in the EHR."), "Documented all assessments in Epic.");
        assert.equal(reword("Precept new graduate nurses.", "Mentor new nurses."), "Mentor new graduate nurses.");
        assert.equal(reword("Worked with suppliers on orders.", "Collaborate with suppliers."), "Collaborated with suppliers on orders.");
        assert.equal(reword("Worked closely with suppliers.", "Partner with suppliers."), "Partnered with suppliers.");
        assert.equal(reword("Building dashboards in Looker.", "Develop dashboards."), "Developing dashboards in Looker.");
        assert.equal(reword("Evaluated vendor bids.", "Analyse vendor bids."), "Analysed vendor bids.");
    });

    it("rewords a past verb after 'and', never a base form there (often a noun)", () => {
        assert.equal(
            reword("Administered IV therapy and charted in Epic.", "Document care in the record."),
            "Administered IV therapy and documented in Epic.",
        );
        assert.equal(reword("Prepared statements and develop the budget.", "Build the budget."), "Prepared statements and develop the budget.");
    });

    it("leaves a line that already uses one of the posting's verbs", () => {
        // "Led" is the posting's "lead"; "manage" is also used, but the line says what the posting says.
        assert.equal(reword("Led a team of 5.", "Lead and manage a team; oversee hiring."), "Led a team of 5.");
    });

    it("never writes in a verb the posting uses mostly as a noun", () => {
        assert.equal(reword("Documented API changes.", "Build charts and dashboards; read the logs."), "Documented API changes.");
        assert.equal(reword("Monitored KPIs weekly.", "A proven track record."), "Monitored KPIs weekly.");
    });

    it("leaves a verb that is part of a phrase ('Managed to', 'Headed up', 'Coordinated with')", () => {
        assert.equal(reword("Managed to cut costs by 10%.", "Oversee the budget."), "Managed to cut costs by 10%.");
        assert.equal(reword("Headed up a team of 12.", "Lead the team."), "Headed up a team of 12.");
        assert.equal(reword("Coordinated with vendors.", "Organize events."), "Coordinated with vendors.");
        assert.equal(reword("Helped shoppers find sizes.", "Support and assist customers."), "Helped shoppers find sizes.");
    });

    it("leaves verbs that also name a different act (drove a truck, delivered a parcel)", () => {
        assert.equal(reword("Drove 600 miles a day.", "Lead the team."), "Drove 600 miles a day.");
        assert.equal(reword("Delivered 120 parcels a day.", "Provide great service."), "Delivered 120 parcels a day.");
    });

    it("uses each of the posting's verbs to open at most one more line in a role", () => {
        const roleOpeners = new Set<string>();
        const wording = readPostingWording("Mentor and coach new staff.");
        const first = rewordLine("Coached new hires.", wording, ctx({ roleOpeners })).after;
        const second = rewordLine("Precepted students.", wording, ctx({ roleOpeners })).after;
        assert.equal(first, "Coached new hires.");
        assert.equal(second, "Mentored students.");
        const third = rewordLine("Precepted nurses.", wording, ctx({ roleOpeners })).after;
        assert.equal(third, "Precepted nurses.", "a second 'Mentored' opener in the same role is left as written");
    });

    it("doesn't touch verbs in the summary", () => {
        assert.equal(reword("Charted care for 30 patients.", "Document care.", { verbs: false }), "Charted care for 30 patients.");
    });
});

describe("rewordLine: spelling", () => {
    it("takes the posting's spelling of the same word, in the line's case", () => {
        assert.equal(reword("Patient counselling on new medications.", "Counseling patients is key."), "Patient counseling on new medications.");
        assert.equal(reword("Organised the stock room.", "Keep the stock room organized."), "Organized the stock room.");
        assert.equal(reword("Built front end features in Javascript.", "Our front-end is JavaScript."), "Built front-end features in JavaScript.");
        assert.equal(reword("Wrote healthcare policy briefs.", "Experience in health care policy."), "Wrote health care policy briefs.");
    });

    it("fixes a product's own capitals but never sentence case or a common word", () => {
        assert.equal(reword("Shipped code on github daily.", "We use GitHub."), "Shipped code on GitHub daily.");
        assert.equal(reword("Manage the team.", "You will manage."), "Manage the team.");
        assert.equal(reword("Helped it run on time.", "IT support for 40 staff."), "Helped it run on time.");
    });

    it("doesn't join words a posting writes apart", () => {
        assert.equal(reword("Set up the overall plan.", "Setup is fast; plan over all regions."), "Set up the overall plan.");
    });
});

describe("rewordLine: acronyms the posting spells out", () => {
    it("reads acronyms off the posting's own definitions", () => {
        assert.deepEqual(postingAcronyms("Maintain customer satisfaction (CSAT) and track Key Performance Indicators (KPIs)."), [
            { short: "CSAT", long: "customer satisfaction" },
            { short: "KPIs", long: "Key Performance Indicators" },
        ]);
        assert.deepEqual(postingAcronyms("Advise on Mergers and Acquisitions (M&A)."), [{ short: "M&A", long: "Mergers and Acquisitions" }]);
        assert.deepEqual(postingAcronyms("Requires a license (Ontario)."), []);
    });

    it("adds the acronym to its long form, or the long form to the acronym, once on the page", () => {
        const posting = "Keep customer satisfaction (CSAT) high. Use the Electronic Health Record (EHR).";
        const acronymsDone = new Set<string>();
        assert.equal(reword("Kept a customer satisfaction score above 92%.", posting, { acronymsDone }), "Kept a customer satisfaction (CSAT) score above 92%.");
        assert.equal(reword("Raised customer satisfaction again.", posting, { acronymsDone }), "Raised customer satisfaction again.");
        assert.equal(reword("Charted in the EHR.", posting), "Charted in the Electronic Health Record (EHR).");
        assert.equal(reword("Charted in the EHR (Epic).", posting), "Charted in the EHR (Epic).");
    });
});

describe("rewordLine: names what changed", () => {
    it("lists the posting's words the line now uses, and nothing when it is unchanged", () => {
        const wording = readPostingWording("Document care. Keep customer satisfaction (CSAT) high.");
        assert.deepEqual(rewordLine("Charted care.", wording, ctx()).terms, ["document"]);
        assert.deepEqual(rewordLine("Gave care.", wording, ctx()).terms, []);
    });
});

describe("equivalentWords: what the grounding gate may accept from the posting", () => {
    it("a verb group the résumé uses, the posting's spelling of a résumé word, an acronym's other half", () => {
        const words = new Set(
            equivalentWords("Charted assessments. Patient counselling. Kept customer satisfaction high.", "Counseling patients. Customer satisfaction (CSAT)."),
        );
        for (const w of ["document", "documented", "counseling", "csat"]) assert.ok(words.has(w), w);
    });

    it("never a skill or tool the résumé doesn't have", () => {
        const words = new Set(equivalentWords("Charted assessments in Epic.", "Document care in Cerner. Kubernetes a plus."));
        for (const w of ["cerner", "kubernetes"]) assert.ok(!words.has(w), w);
    });
});

describe("rewordLine: a verb before 'in' or 'on'", () => {
    it("rewords it before a name (where it was done), not before a common word (a phrase)", () => {
        assert.equal(reword("Charted in Epic daily.", "Document care."), "Documented in Epic daily.");
        assert.equal(reword("Logged in the system daily.", "Document care."), "Logged in the system daily.");
    });
});

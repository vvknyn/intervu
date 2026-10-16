import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { familiesNamedBy } from "../../src/lib/match/duty-signals";
import { roleAffinity } from "../../src/lib/match/score";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Merative's "Portfolio Manager, Technology Product Management", one of the 17 postings Vivek pasted as roles he wants
 * (2026-10-16), read as no kind of role: the product pattern is "product manager", and "Portfolio Manager" names none.
 * So a product résumé had to prove it from its text, and the short text could not. A title that holds a leader role word
 * now reads its "X Management" as "X Manager"; one without reads as written.
 */
describe("a title that runs a discipline reads as that discipline's kind of role", () => {
    for (const [title, families] of [
        ["Portfolio Manager, Technology Product Management", ["product"]],
        ["Director, Product Management", ["product"]],
        ["Senior Manager, Program Management", ["operations"]],
        ["Product Management Intern", []],
        ["Product Management Office Coordinator", []],
        ["Account Management Specialist", []],
    ] as const) {
        it(`${title}: ${families.length > 0 ? families.join(", ") : "no family"}`, () => {
            assert.deepEqual(familiesNamedBy([title]), families);
        });
    }

    it("the TAM family's own reading of \"Technical Account Management\" is unchanged", () => {
        assert.deepEqual(familiesNamedBy(["Director, Technical Account Management"]), ["customer_success"]);
    });

    it("a product résumé reads the Merative title as its own kind of work, and a TAM résumé as one next to it", () => {
        const load = (file: string) => resumeDataFromPlainText(readFileSync(path.join(process.cwd(), "tests/fixtures", file), "utf8"));
        const job = { id: "merative", title: "Portfolio Manager, Technology Product Management", description: "" } as unknown as PublicJob;
        assert.equal(roleAffinity(load("vivek-pm-resume.txt"), job), "family");
        assert.equal(roleAffinity(load("vivek-tam-resume.txt"), job), "adjacent");
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    jobTitleMatchesTarget,
    partitionByTargetTitle,
    targetTitlesFromQuery,
} from "../../src/lib/jobs/for-you/title-relevance";
import type { PublicJob } from "../../src/lib/jobs/types";

function job(id: string, title: string): PublicJob {
    return { id, title } as PublicJob;
}

describe("targetTitlesFromQuery", () => {
    it("splits a plain (unquoted) OR list — the form a typed/agent-set query actually arrives in", () => {
        assert.deepEqual(
            targetTitlesFromQuery(
                "Technical Account Manager OR Implementation Manager OR Technical Customer Success",
            ),
            ["Technical Account Manager", "Implementation Manager", "Technical Customer Success"],
        );
    });

    it("strips quotes from a quoted OR list (the fit-phrase lane's own format)", () => {
        assert.deepEqual(targetTitlesFromQuery('"Backend Engineer" OR "Platform Engineer"'), [
            "Backend Engineer",
            "Platform Engineer",
        ]);
    });

    it("a single title (no OR) is one target", () => {
        assert.deepEqual(targetTitlesFromQuery("Backend Engineer"), ["Backend Engineer"]);
    });

    it("empty/absent query names no targets", () => {
        assert.deepEqual(targetTitlesFromQuery(""), []);
        assert.deepEqual(targetTitlesFromQuery(undefined), []);
        assert.deepEqual(targetTitlesFromQuery(null), []);
    });
});

describe("jobTitleMatchesTarget", () => {
    it("the reported case: a PM title does not match any of the TAM/Implementation/TCS targets", () => {
        const title = "Product Manager, Login, Authentication & Client Protection";
        assert.equal(jobTitleMatchesTarget(title, "Technical Account Manager"), false);
        assert.equal(jobTitleMatchesTarget(title, "Implementation Manager"), false);
        assert.equal(jobTitleMatchesTarget(title, "Technical Customer Success"), false);
    });

    it("token order in the job title doesn't matter (every target token still has to appear)", () => {
        assert.equal(
            jobTitleMatchesTarget("Customer Success Manager, Technical", "Technical Customer Success"),
            true,
        );
    });

    it("tolerates a rank-word spelling difference (Sr. vs Senior) via RANK_WORDS, not exact text", () => {
        assert.equal(jobTitleMatchesTarget("Sr. Software Engineer", "Senior Software Engineer"), true);
        // Same tolerance the other direction, and case-insensitively.
        assert.equal(jobTitleMatchesTarget("senior software engineer", "Sr Software Engineer"), true);
    });

    it("Software Engineering Manager DOES match target Software Engineer under this rule", () => {
        // The rule tolerates plural via prefix (`titleMatchesQuery`'s own
        // convention, presentation.ts): a target token matches any job token
        // that STARTS WITH it, not one that equals it exactly. "engineer" is
        // a literal prefix of "engineering", so this is prefix containment,
        // not a false positive introduced by this function — it's the same
        // breadth the SERP's own title match already accepts. A stricter
        // (suffix-aware) rule was deliberately not built for this: nothing
        // else in the repo needs it, and the existing tokenizer already
        // gives every other required case above the right answer.
        assert.equal(jobTitleMatchesTarget("Software Engineering Manager", "Software Engineer"), true);
    });

    it("no significant tokens left in the target (e.g. only a rank word) never matches", () => {
        assert.equal(jobTitleMatchesTarget("Senior Software Engineer", "Senior"), false);
    });
});

describe("partitionByTargetTitle", () => {
    const pm = job("pm", "Product Manager, Login, Authentication & Client Protection");
    const tam = job("tam", "Technical Account Manager");
    const impl = job("impl", "Implementation Manager, EMEA");
    const other = job("other", "Warehouse Associate");

    it("the reported case: TAM/Implementation cards move ahead of the non-matching PM card", () => {
        const query = "Technical Account Manager OR Implementation Manager OR Technical Customer Success";
        const out = partitionByTargetTitle([pm, tam, impl, other], query);
        assert.deepEqual(
            out.map((j) => j.id),
            ["tam", "impl", "pm", "other"],
        );
    });

    it("is a STABLE partition — relative order within each group is preserved, nothing is hidden", () => {
        const query = "Technical Account Manager OR Implementation Manager OR Technical Customer Success";
        const out = partitionByTargetTitle([pm, impl, tam, other], query);
        assert.equal(out.length, 4); // nothing dropped
        assert.deepEqual(
            out.map((j) => j.id),
            ["impl", "tam", "pm", "other"], // impl still before tam (their input order), pm still before other
        );
    });

    it("a single-title query still partitions", () => {
        const out = partitionByTargetTitle([pm, tam, other], "Technical Account Manager");
        assert.deepEqual(
            out.map((j) => j.id),
            ["tam", "pm", "other"],
        );
    });

    it("no query / no target titles → identical order (same array contents and sequence)", () => {
        const input = [pm, other, tam, impl];
        assert.deepEqual(partitionByTargetTitle(input, "").map((j) => j.id), input.map((j) => j.id));
        assert.deepEqual(partitionByTargetTitle(input, undefined).map((j) => j.id), input.map((j) => j.id));
    });

    it("no card matches any target → identical order, nothing hidden", () => {
        const input = [pm, other];
        const out = partitionByTargetTitle(input, "Registered Nurse");
        assert.deepEqual(out.map((j) => j.id), ["pm", "other"]);
    });
});

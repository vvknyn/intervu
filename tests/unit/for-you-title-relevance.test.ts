import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    jobTitleMatchesTarget,
    targetTitlesFromQuery,
} from "../../src/lib/jobs/for-you/title-relevance";
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

    it("a comma-inverted title reads in its spoken order", () => {
        assert.equal(
            jobTitleMatchesTarget("Customer Success Manager, Technical", "Technical Customer Success"),
            true,
        );
        assert.equal(jobTitleMatchesTarget("Engineer, Software", "Software Engineer"), true);
        assert.equal(jobTitleMatchesTarget("Senior Manager, Product", "Product Manager"), true);
    });

    it("the target's words must be a contiguous phrase, not merely all present", () => {
        // All three are retrieved by a Product Manager lane (Meili matches words) — none is a PM.
        assert.equal(jobTitleMatchesTarget("Product Marketing Manager", "Product Manager"), false);
        assert.equal(jobTitleMatchesTarget("Product Operations Manager", "Product Manager"), false);
        assert.equal(jobTitleMatchesTarget("Product Development Manager", "Product Manager"), false);
        // A people manager of TAMs is not a TAM role.
        assert.equal(jobTitleMatchesTarget("Manager, Technical Account Management", "Technical Account Manager"), false);
        // RPN is a different licence from RN.
        assert.equal(jobTitleMatchesTarget("Registered Practical Nurse - Foot Care Nurse", "Registered Nurse"), false);
        // Still a PM / RN with words around the phrase.
        assert.equal(jobTitleMatchesTarget("Technical Product Manager II", "Product Manager"), true);
        assert.equal(jobTitleMatchesTarget("Product Manager - Emergency Care", "Product Manager"), true);
        assert.equal(jobTitleMatchesTarget("Registered Nurse (RN) - ICU", "Registered Nurse"), true);
    });

    it("whole words only: a word that merely starts with the target's word is another word", () => {
        assert.equal(jobTitleMatchesTarget("Production Manager", "Product Manager"), false);
        assert.equal(jobTitleMatchesTarget("Salesforce Administrator", "Sales Associate"), false);
        assert.equal(jobTitleMatchesTarget("Nursery Teacher", "Nurse"), false);
        assert.equal(jobTitleMatchesTarget("Database Analyst", "Data Analyst"), false);
        assert.equal(jobTitleMatchesTarget("Artificial Intelligence Director", "Art Director"), false);
        // Plurals still match either way.
        assert.equal(jobTitleMatchesTarget("Account Managers", "Account Manager"), true);
        assert.equal(jobTitleMatchesTarget("Account Manager", "Account Managers"), true);
    });

    it("tolerates a rank-word spelling difference (Sr. vs Senior) via RANK_WORDS, not exact text", () => {
        assert.equal(jobTitleMatchesTarget("Sr. Software Engineer", "Senior Software Engineer"), true);
        // Same tolerance the other direction, and case-insensitively.
        assert.equal(jobTitleMatchesTarget("senior software engineer", "Sr Software Engineer"), true);
    });

    it("Software Engineering Manager is not a Software Engineer's own role", () => {
        // Previously true by prefix ("engineer" starts "engineering"), which
        // ranked an engineering-manager posting as an IC engineer's own role.
        assert.equal(jobTitleMatchesTarget("Software Engineering Manager", "Software Engineer"), false);
    });

    it("no significant tokens left in the target (e.g. only a rank word) never matches", () => {
        assert.equal(jobTitleMatchesTarget("Senior Software Engineer", "Senior"), false);
    });
});

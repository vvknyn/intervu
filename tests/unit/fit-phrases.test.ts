import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatQuotedOrQuery,
    parseQuotedOrPhrases,
    resolveFitPhrases,
    shouldRunFitPhraseLane,
} from "../../src/lib/jobs/fit-phrases";

describe("formatQuotedOrQuery", () => {
    it("returns empty string for no phrases", () => {
        assert.equal(formatQuotedOrQuery([]), "");
    });

    it("returns unquoted text for a single phrase", () => {
        assert.equal(formatQuotedOrQuery(["Product Manager"]), "Product Manager");
    });

    it("joins two or more phrases with quoted OR", () => {
        assert.equal(
            formatQuotedOrQuery(["Product Manager", "Software Engineer"]),
            '"Product Manager" OR "Software Engineer"',
        );
    });

    it("strips embedded quotes from phrases", () => {
        assert.equal(formatQuotedOrQuery(['Product "Lead" Manager', "Go"]), '"Product Lead Manager" OR "Go"');
    });
});

describe("parseQuotedOrPhrases", () => {
    it("parses quoted OR queries into phrases", () => {
        assert.deepEqual(parseQuotedOrPhrases('"Product Manager" OR "Software Engineer"'), [
            "Product Manager",
            "Software Engineer",
        ]);
    });

    it("accepts case-insensitive OR", () => {
        assert.deepEqual(parseQuotedOrPhrases('"A" or "B"'), ["A", "B"]);
    });

    it("returns null for unquoted Director OR Manager", () => {
        assert.equal(parseQuotedOrPhrases("Director OR Manager"), null);
    });

    it("returns null for mixed quoted/unquoted parts", () => {
        assert.equal(parseQuotedOrPhrases('"Product Manager" OR Manager'), null);
    });

    it("returns null for unbalanced quotes", () => {
        assert.equal(parseQuotedOrPhrases('"Product Manager OR "Software Engineer"'), null);
    });

    it("returns null for a single quoted phrase", () => {
        assert.equal(parseQuotedOrPhrases('"Product Manager"'), null);
    });
});

describe("resolveFitPhrases", () => {
    it("prefers explicit fitPhrases when two or more are provided", () => {
        assert.deepEqual(
            resolveFitPhrases({
                q: '"Ignored" OR "Query"',
                fitPhrases: ["Product Manager", "Software Engineer"],
            }),
            ["Product Manager", "Software Engineer"],
        );
    });

    it("falls back to parsing quoted-OR q", () => {
        assert.deepEqual(resolveFitPhrases({ q: '"A" OR "B"' }), ["A", "B"]);
    });
});

describe("shouldRunFitPhraseLane", () => {
    it("is true when two or more fit phrases resolve", () => {
        assert.equal(shouldRunFitPhraseLane({ q: '"A" OR "B"' }), true);
    });

    it("is false for unquoted OR prose", () => {
        assert.equal(shouldRunFitPhraseLane({ q: "Director OR Manager" }), false);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LANDING = join(__dirname, "../../src/components/onboarding/ConceptALanding.tsx");

const EXPECTED_POSTCARD_TITLES = [
    "Remote AI Roles",
    "Product Designer",
    "Growth Marketing Lead",
    "Data Scientist",
    "Software Engineer",
];

function extractPostcardTitles(src: string): string[] {
    const block = src.match(/const POSTCARDS[\s\S]*?\n\];/)?.[0] ?? "";
    return [...block.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("Concept A landing postcard copy", () => {
    it("postcard job titles stay title case (guard against sentence-case drift)", () => {
        const titles = extractPostcardTitles(readFileSync(LANDING, "utf8"));
        assert.deepEqual(titles, EXPECTED_POSTCARD_TITLES);
    });
});

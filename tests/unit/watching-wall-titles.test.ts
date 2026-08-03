import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCHING_WALL_TITLES } from "../../src/components/marketing/watching-wall-titles";

const ALLOWED_COMPANIES = ["Ramp", "Vanta", "Deel"];
// Loosely catches an accidentally-added real company name that isn't one of
// the three the marketing thread already names — a title is only flagged if
// it contains an em-dash attribution (" — Company") that isn't one of the
// allowed three; bare role titles (no " — ") always pass.
function attributedCompany(title: string): string | null {
    const parts = title.split(" — ");
    return parts.length === 2 ? parts[1] : null;
}

test("WATCHING_WALL_TITLES has ~40 entries, all non-empty and unique", () => {
    assert.ok(WATCHING_WALL_TITLES.length >= 40, "expected at least 40 titles");
    assert.ok(WATCHING_WALL_TITLES.every((t) => t.trim().length > 0));
    assert.equal(new Set(WATCHING_WALL_TITLES).size, WATCHING_WALL_TITLES.length, "titles must be unique");
});

test("WATCHING_WALL_TITLES only attributes the three companies named in the marketing thread", () => {
    for (const title of WATCHING_WALL_TITLES) {
        const company = attributedCompany(title);
        if (company !== null) {
            assert.ok(
                ALLOWED_COMPANIES.includes(company),
                `unexpected company "${company}" in "${title}" — only Ramp/Vanta/Deel are allowed`,
            );
        }
    }
});

test("WATCHING_WALL_TITLES includes at least one entry per allowed company", () => {
    for (const company of ALLOWED_COMPANIES) {
        assert.ok(
            WATCHING_WALL_TITLES.some((t) => attributedCompany(t) === company),
            `expected at least one title attributed to ${company}`,
        );
    }
});

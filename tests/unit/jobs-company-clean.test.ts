import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCompany } from "../../src/lib/jobs/presentation";

// Real production company strings, retrieved live 2026-07-26.

test("strips a leading ATS tenant code", () => {
    assert.equal(cleanCompany("QLYS_CA Qualys Canada Ltd."), "Qualys Canada Ltd.");
});

test("strips a trailing parenthetical that duplicates the name's own tokens", () => {
    assert.equal(cleanCompany("STERIS Canada Sales ULC (Canada Sales)"), "STERIS Canada Sales ULC");
});

test("keeps a trailing parenthetical that adds information not in the name", () => {
    assert.equal(cleanCompany("Ingram Micro Inc. (Canada)"), "Ingram Micro Inc. (Canada)");
});

test("keeps a trailing parenthetical that's an expansion, not a duplicate", () => {
    assert.equal(cleanCompany("inog (irish network operators group)"), "inog (irish network operators group)");
});

test("keeps a trailing parenthetical naming a country the base name doesn't carry", () => {
    assert.equal(cleanCompany("The Toronto-Dominion Bank (Canada)"), "The Toronto-Dominion Bank (Canada)");
});

test("still strips the older leading req/location code shape", () => {
    assert.equal(cleanCompany("USA102 Acme Inc"), "Acme Inc");
});

test("null/undefined pass through as empty string", () => {
    assert.equal(cleanCompany(null), "");
    assert.equal(cleanCompany(undefined), "");
});

test("strips ATS portal hostnames", () => {
    assert.equal(cleanCompany("limble.applicantpro.com"), "");
    assert.equal(cleanCompany("jobs.greenhouse.io"), "");
});

test("strips bare domain placeholders", () => {
    assert.equal(cleanCompany("acme.example.com"), "");
});

test("keeps real company names that are not bare domains", () => {
    assert.equal(cleanCompany("Acme Inc."), "Acme Inc.");
});

test("strips leading hyphenated req codes", () => {
    assert.equal(cleanCompany("NDIN-North Dakota Information Network"), "North Dakota Information Network");
});

test("strips leading C-prefix codes", () => {
    assert.equal(cleanCompany("C0001 Widget Corp"), "Widget Corp");
});

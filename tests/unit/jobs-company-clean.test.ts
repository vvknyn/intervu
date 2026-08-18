import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCompany, displayCompany, displayCompanyName, humanizeTenantSubdomain } from "../../src/lib/jobs/presentation";

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

test("displayCompany falls back to the domain when the name is bare-domain-shaped", () => {
    assert.equal(displayCompany("Bill.com", "bill.com"), "bill.com");
});

test("displayCompany falls back to the domain when the name is an ATS portal hostname", () => {
    assert.equal(displayCompany("acme.applicantpro.com", "acme.com"), "acme.com");
});

test("displayCompany passes through a real cleaned name unchanged", () => {
    assert.equal(displayCompany("Novacredit", "novacredit.com"), "Novacredit");
});

test("displayCompany passes through an already-clean name even when a domain is present", () => {
    assert.equal(displayCompany("Acme Inc.", "acme.com"), "Acme Inc.");
});

test("displayCompany returns empty string when both name and domain are absent", () => {
    assert.equal(displayCompany(null, null), "");
});

test("displayCompany fixes the reported bug: a domain-shaped brand name no longer contradicts the rendered favicon", () => {
    assert.equal(displayCompany("Super.Com", "super.com"), "super.com");
});

// displayCompanyName — /co/[slug]'s display-name suffix strip. Runs on top
// of cleanCompany, so the leading-tenant-code case exercises both in one pass.
test("displayCompanyName strips a tenant code AND a trailing comma'd legal suffix", () => {
    assert.equal(displayCompanyName("LE0001 ServiceTitan, Inc."), "ServiceTitan");
});

test("displayCompanyName strips a bare, no-comma 'Inc.' at the end", () => {
    assert.equal(displayCompanyName("Apple Inc."), "Apple");
});

test("displayCompanyName leaves a name with no legal suffix unchanged", () => {
    assert.equal(displayCompanyName("Stripe"), "Stripe");
});

test("displayCompanyName does not touch a suffix WORD that isn't a trailing, comma'd/bare suffix", () => {
    // "Inc" opens the name here rather than closing it — the match is
    // end-anchored, so a name that merely CONTAINS the word survives.
    assert.equal(displayCompanyName("Inc Magazine"), "Inc Magazine");
});

test("displayCompanyName never strips down to an empty/whitespace-only remainder", () => {
    assert.equal(displayCompanyName(", Inc."), ", Inc.");
});

test("displayCompanyName strips other comma-form suffixes from the list (LLC, Ltd., Corp., GmbH)", () => {
    assert.equal(displayCompanyName("Acme, LLC"), "Acme");
    assert.equal(displayCompanyName("Widgets, Ltd."), "Widgets");
    assert.equal(displayCompanyName("Globex, Corp."), "Globex");
    assert.equal(displayCompanyName("Muster, GmbH"), "Muster");
});

test("displayCompanyName strips the bare 'Limited' form but leaves a bare 'Ltd'/'Corp' (not in the bare-word list) intact", () => {
    assert.equal(displayCompanyName("Acme Limited"), "Acme");
    assert.equal(displayCompanyName("Acme Ltd"), "Acme Ltd");
    assert.equal(displayCompanyName("Acme Corp"), "Acme Corp");
});

test("displayCompanyName matches case-insensitively", () => {
    assert.equal(displayCompanyName("acme, inc."), "acme");
});

test("displayCompanyName null/undefined pass through as empty string", () => {
    assert.equal(displayCompanyName(null), "");
    assert.equal(displayCompanyName(undefined), "");
});

// humanizeTenantSubdomain / cleanCompany — generic careers-subdomain prefix
// stripping. Live bug 2026-08: a job row rendered "Careers.algoleap" as the
// company name because the bare-domain rule routed it to
// humanizeTenantSubdomain, which stripped a trailing TLD but never a leading
// subdomain like "careers.". Cases below prove the fix is class-wide (several
// distinct prefixes, a stacked prefix), not a single hardcoded string, and
// that the guard rails against over-stripping hold.

test("strips the generic 'careers' subdomain prefix — the reported live bug", () => {
    assert.equal(humanizeTenantSubdomain("Careers.algoleap"), "Algoleap");
    assert.equal(cleanCompany("Careers.algoleap"), "Algoleap");
});

test("strips other generic subdomain prefixes — class-wide, not one instance", () => {
    assert.equal(humanizeTenantSubdomain("jobs.acme"), "Acme");
    assert.equal(humanizeTenantSubdomain("www.foo.com"), "Foo");
    assert.equal(humanizeTenantSubdomain("apply.widgetco"), "Widgetco");
    assert.equal(humanizeTenantSubdomain("talent.zippy"), "Zippy");
});

test("strips a stacked run of generic prefixes down to the real brand", () => {
    assert.equal(humanizeTenantSubdomain("careers.jobs.acme"), "Acme");
});

// Guard rail 1: a real company name that happens to BE a generic word plus
// "Inc" has a space, so cleanCompany's bare-domain rule (which requires no
// space) never routes it to humanizeTenantSubdomain in the first place.
test("guard rail: a real company name that IS the stripped word survives untouched", () => {
    assert.equal(cleanCompany("Careers Inc"), "Careers Inc");
});

// Guard rail 2: "Amazon.com" has no subdomain prefix to strip — the existing
// trailing-TLD rule already turns it into "Amazon", and the new prefix logic
// must not touch or break that unrelated path.
test("guard rail: 'Amazon.com' still resolves via the existing TLD-suffix rule, not prefix logic", () => {
    assert.equal(humanizeTenantSubdomain("Amazon.com"), "Amazon");
});

// Guard rail 3: a single-label token has no leading-prefix-then-remainder
// structure at all, so it is left alone by construction.
test("guard rail: a single-label token with no dot is untouched", () => {
    assert.equal(humanizeTenantSubdomain("Acme"), "Acme");
    assert.equal(humanizeTenantSubdomain("jobs"), "Jobs");
});

// Guard rail 4: stripping must never leave an empty string. "careers.com"
// loses its TLD first (the existing suffix rule), leaving the single label
// "careers" — which guard rail 3's single-label rule then leaves alone,
// rather than being read as prefix "careers" + a meaningless "com" remainder.
test("guard rail: 'careers.com' does not crash or collapse to an empty name", () => {
    assert.equal(humanizeTenantSubdomain("careers.com"), "Careers");
});

// A token that is ENTIRELY generic words never loses its last label either —
// same "always leave one label standing" invariant, exercised with no real
// TLD present to strip first.
test("guard rail: an all-generic-words token keeps its last label instead of stripping to nothing", () => {
    assert.equal(humanizeTenantSubdomain("careers.jobs"), "Jobs");
});

// Guard rail 5 (corpus measurement, 2026-08-18): real brand names that are
// THEMSELVES styled like a domain — company + ".com"/".ai" IS the name, not
// a placeholder — sit in the same dot-no-space shape the bare-domain rule
// matches. Real production values (`job_listings`, GROUP BY): Roadsurfer.Com
// (459), Checkout.Com (429), Scrums.com (416), Kraken.Com (337), Jerry.Ai
// (296). The bare-domain branch already strips their TLD today — a
// pre-existing characteristic of `cleanCompany` this change does not touch —
// and the new subdomain-PREFIX logic must be a no-op on all five: none of
// these words are in `GENERIC_SUBDOMAIN_PREFIXES`, and a single-label token
// (post TLD-strip) is left alone by guard rail 3 regardless. Proves the new
// prefix rule doesn't WIDEN what already happens to this class.
test("guard rail: dot-styled real brand names are untouched by the new prefix rule (pre-existing TLD-strip still fires, unchanged)", () => {
    for (const [raw, expected] of [
        ["Roadsurfer.Com", "Roadsurfer"],
        ["Checkout.Com", "Checkout"],
        ["Scrums.com", "Scrums"],
        ["Kraken.Com", "Kraken"],
        ["Jerry.Ai", "Jerry"],
    ] as const) {
        assert.equal(cleanCompany(raw), expected, raw);
    }
});

// The exact live stored value (2026-08-18 measurement), WITH its real ".com"
// suffix — the module-doc example above uses the bare "Careers.algoleap"
// shape; this pins the literal production string, and that its clean form
// ("Algoleap") matches the 27 rows already stored clean for the same
// employer, so the fix converges the two spellings.
test("strips the real stored 'careers.algoleap.com' value to match the already-clean form in the same table", () => {
    assert.equal(cleanCompany("careers.algoleap.com"), "Algoleap");
});

// Second high-volume URL-ish-prefix instance (636 rows) — proves the prefix
// rule generalizes past the "careers"/"jobs" examples to "www" too, on a
// value with no known-ATS-provider match and no recognized trailing TLD.
test("strips a 'www.' prefix off a bare non-TLD-suffixed placeholder ('www.google', 636 rows live)", () => {
    assert.equal(cleanCompany("www.google"), "Google");
});

// Leading entity-code stripping (existing mechanism, unmodified) generalizes
// to a SECOND QLYS_* variant beyond the one already pinned above ("QLYS_CA")
// — confirms the regex is shape-based (2-10 alnum + "_" + 2-10 alnum + space),
// not a hardcoded "QLYS_CA" lookup, on the real "QLYS_IN" stored value.
test("the existing leading-entity-code strip generalizes to a different real QLYS_* variant (QLYS_IN, 451 rows live)", () => {
    assert.equal(
        cleanCompany("QLYS_IN Qualys Security TechServices Private Ltd."),
        "Qualys Security TechServices Private Ltd.",
    );
});

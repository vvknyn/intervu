import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCompany, displayCompany, displayCompanyBrand, displayCompanyName, humanizeTenantSubdomain, preferBrandSegment } from "../../src/lib/jobs/presentation";

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

// 2026-08-16 (bccde83): cleanCompany stopped blanking ATS-portal hostnames
// and started extracting a best-effort tenant name instead — a blank name
// next to a real favicon was the actual complaint (#150), and the module
// doc above states this branch's job as "extract clean company brand
// names," not blank them. What must never regress is the RAW ATS-portal
// hostname leaking onto the screen verbatim.
test("strips ATS portal hostnames, extracting a humanized tenant name rather than showing the raw hostname", () => {
    const limble = cleanCompany("limble.applicantpro.com");
    assert.equal(limble, "Limble");
    assert.ok(!limble.includes("."), `must not leak the raw hostname, got ${JSON.stringify(limble)}`);

    const greenhouse = cleanCompany("jobs.greenhouse.io");
    assert.equal(greenhouse, "Jobs");
    assert.ok(!greenhouse.includes("."), `must not leak the raw hostname, got ${JSON.stringify(greenhouse)}`);
});

// Unlike an ATS-portal hostname or a single-label brand-styled domain
// (guard rail 5 below), a bare THREE-OR-MORE-LABEL domain with no
// recognized ATS provider and no generic subdomain prefix carries no
// reliable brand signal — "acme.example.com" could mean "Acme" (a
// subdomain of some portal at example.com) or "Example" (the registrable
// domain, "acme" an internal product/region label), and there's no way to
// tell which. Guessing either presents an unverified name as fact, which
// fails harder than an empty gap. humanizeTenantSubdomain enforces this: an
// unresolved multi-label remainder returns "" rather than the malformed,
// still-dotted guess it produced before this fix ("Acme.example") — itself
// just the raw-hostname leak this whole extraction exists to stop, merely
// capitalized.
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

// cleanCompany's own placeholder-extraction (bccde83) already resolves a
// bare-domain-shaped name to a humanized brand — displayCompany's domain
// argument here is a second signal that happens to agree, not the thing
// producing the value. What the test guards is unchanged: the label must
// never fall back to the raw domain string ("bill.com" reads as a URL, not
// a company name).
test("displayCompany extracts a humanized brand, not the raw domain string, when the name is bare-domain-shaped", () => {
    assert.equal(displayCompany("Bill.com", "bill.com"), "Bill");
});

test("displayCompany extracts a humanized brand, not the raw domain string, when the name is an ATS portal hostname", () => {
    assert.equal(displayCompany("acme.applicantpro.com", "acme.com"), "Acme");
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

// #150's original fix made displayCompany fall back to the raw domain
// STRING ("super.com") so the label could never visually disagree with
// itself. Right call at the time — but the favicon it was protecting
// (CompanyLogo.tsx -> companyLogoUrl, lib/companies/logo.ts) is an <img>
// fetched from Google's favicon service: an ICON, not rendered text. An
// icon can't "contradict" a text label the way a blank/"Unknown company"
// label next to a real logo did (the actual #150 bug — see its commit
// message). bccde83 (2026-08-16) moved the fallback from the raw domain to
// a humanized brand for exactly that reason: "super.com" reads as a URL,
// not a company name, and it's the same domain-styled-brand shape guard
// rail 5 below already resolves the same way (Checkout.Com -> "Checkout").
test("displayCompany fixes the reported bug: a blank or raw-domain company name no longer sits next to the rendered favicon", () => {
    assert.equal(displayCompany("Super.Com", "super.com"), "Super");
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

// 2026-08-29 (corp-suffix audit): "Ltd"/"Corp" moved from GEO_GATED_TAIL_WORDS
// to BARE_LEGAL_SUFFIXES — pure legal designators no brand chooses as its
// own name ending, so they now strip unconditionally like "Limited" always
// has, no geography bracket required. See presentation.ts's
// BARE_LEGAL_SUFFIXES doc for the full argument.
test("displayCompanyName strips the bare 'Limited'/'Ltd'/'Corp' forms unconditionally — pure legal designators need no geography signal", () => {
    assert.equal(displayCompanyName("Acme Limited"), "Acme");
    assert.equal(displayCompanyName("Acme Ltd"), "Acme");
    assert.equal(displayCompanyName("Acme Corp"), "Acme");
});

// Live production evidence, 2026-08-18: `q=qualys` returned three different-
// looking company labels on ONE results page — a user reads that as three
// employers, not one under three legal spellings. All three forms strip to
// the same brand (or, for the third, to the same NON-brand root the class
// change is scoped to — see the module doc's note on brand-root unification
// being explicitly out of scope).
test("displayCompanyName strips all three real Qualys legal-entity forms", () => {
    assert.equal(displayCompanyName("Qualys, Inc."), "Qualys");
    assert.equal(displayCompanyName("Qualys Ltd."), "Qualys");
    assert.equal(displayCompanyName("Qualys Security TechServices Private Ltd."), "Qualys Security TechServices");
});

// cleanCompany (the grouping/counting/slug/tally value) must NOT move —
// only displayCompanyName's presentation layer changed.
test("cleanCompany keeps the suffixed form for all three Qualys strings — grouping/tally is unaffected", () => {
    assert.equal(cleanCompany("Qualys, Inc."), "Qualys, Inc.");
    assert.equal(cleanCompany("Qualys Ltd."), "Qualys Ltd.");
    assert.equal(cleanCompany("Qualys Security TechServices Private Ltd."), "Qualys Security TechServices Private Ltd.");
});

// The bare-form vocabulary generalizes past Qualys/Inc./Limited — an Indian
// "Pvt Ltd" and a German "GmbH", neither hand-picked before this change.
test("displayCompanyName strips bare legal forms class-wide, not just the two originally hand-picked", () => {
    assert.equal(displayCompanyName("Nimbus Solutions Pvt Ltd"), "Nimbus Solutions");
    assert.equal(displayCompanyName("Muster Systeme GmbH"), "Muster Systeme");
});

// Singapore / Malaysia / Brazil / Netherlands / Spain forms seen in the Oct 2026 directory evidence tails.
test("displayCompanyName strips the Pte, Sdn Bhd, Ltda, S.R.L., C.V. and S.L. families", () => {
    assert.equal(displayCompanyName("Orion Freight Pte. Ltd."), "Orion Freight");
    assert.equal(displayCompanyName("Air Liquide Pte."), "Air Liquide");
    assert.equal(displayCompanyName("Kopi Trading Sdn. Bhd."), "Kopi Trading");
    assert.equal(displayCompanyName("Kopi Trading Sdn Bhd"), "Kopi Trading");
    assert.equal(displayCompanyName("Verde Logistica Ltda."), "Verde Logistica");
    assert.equal(displayCompanyName("Ayvens Service Center SRL"), "Ayvens Service Center");
    assert.equal(displayCompanyName("Tulip Markets C.V."), "Tulip Markets");
    assert.equal(displayCompanyName("Sol Energia S.L."), "Sol Energia");
    assert.equal(displayCompanyName("Pavo Holdings LLC."), "Pavo Holdings");
});

// Negatives the growth must not touch.
test("displayCompanyName negatives survive the widened bare-form vocabulary untouched", () => {
    // A legal-form word that opens the name, not closes it — end-anchored,
    // so mere containment is never enough.
    assert.equal(displayCompanyName("Inc Magazine"), "Inc Magazine");
    assert.equal(displayCompanyName("Limited Brands"), "Limited Brands");
    // A name that IS only a legal form: stripping the trailing "Ltd." would
    // leave "Private", which is itself just another legal-form word — the
    // general remainder-purity rule rejects that, not a hand-picked
    // exception for this one string.
    assert.equal(displayCompanyName("Private Ltd."), "Private Ltd.");
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

test("ccTLD and short gTLD last labels humanize — not just .com", () => {
    assert.equal(humanizeTenantSubdomain("binance.us"), "Binance");
    assert.equal(humanizeTenantSubdomain("Binance.Us"), "Binance");
    assert.equal(humanizeTenantSubdomain("relay.club"), "Relay");
    assert.equal(humanizeTenantSubdomain("acme.inc"), "Acme");
    assert.equal(displayCompanyBrand("Binance.Us", "binance.us"), "Binance");
    assert.equal(displayCompany("Binance.Us", "binance.us"), "Binance");
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

// displayCompanyName — prose-safe display of legal-entity strings, 2026-08-21.
// Real production examples, pixel-verified live on /jobs the same day.
// See presentation.ts's `stripLegalTail`/`GEO_GATED_TAIL_WORDS`/
// `stackedGeographyParen` for the mechanism these exercise.

test("strips a stacked 'geography + structure-noun + legal-designator' tail — the Michael Kors shape", () => {
    assert.equal(displayCompanyName("Michael Kors (Canada) Holdings LTD"), "Michael Kors");
});

// "Stryker" alone was also considered — see stackedGeographyParen's doc for
// why an UNBRACKETED trailing country word is deliberately left alone
// (it's load-bearing in real brand names like "Air Canada"/"Canada Goose");
// only the bracketed shape ever gets read as a legal qualifier.
test("strips an unambiguous foreign designator (ULC) but leaves the bare, unbracketed geography token alone", () => {
    assert.equal(displayCompanyName("Stryker Canada ULC"), "Stryker Canada");
});

test("strips a punctuated 'Co.' with no comma and no geography needed — punctuation alone makes it unambiguous", () => {
    assert.equal(displayCompanyName("Autodesk Canada Co."), "Autodesk Canada");
});

test("strips the '^Company N - ' upstream row-index prefix, leaving a trailing bare 'Company' untouched", () => {
    // The trailing bare "Company" is NOT stripped: it's a geo-gated word
    // (see GEO_GATED_TAIL_WORDS's doc) and there's no bracketed geography
    // qualifier anywhere in this name to corroborate it — "The Manufacturers
    // Life Insurance Company" IS this employer's real, whole legal name.
    assert.equal(
        displayCompanyName("Company 1 - The Manufacturers Life Insurance Company"),
        "The Manufacturers Life Insurance Company",
    );
});

test("the '^Company N - ' prefix strip generalizes past N=1 — class-wide, not one instance", () => {
    assert.equal(displayCompanyName("Company 47 - Beacon Health Options"), "Beacon Health Options");
});

// Explicitly out of scope: no legal designator anywhere in this name, so
// there is nothing for stripLegalTail to key off — "Property Management
// Services" is real, load-bearing brand content, not a stripped legal tail.
test("leaves a name with no legal designator at all untouched, even though it reads like a long legal form", () => {
    assert.equal(
        displayCompanyName("Greystar Canada Property Management Services"),
        "Greystar Canada Property Management Services",
    );
});

test("control: a plain two-word brand with no designator anywhere is untouched", () => {
    assert.equal(displayCompanyName("Best Buy"), "Best Buy");
});

test("simple dotted-suffix case still works unchanged (Gap Inc. -> Gap)", () => {
    assert.equal(displayCompanyName("Gap Inc."), "Gap");
});

test("a leading, non-trailing 'Inc' is never touched — end-anchored matching, not substring matching", () => {
    assert.equal(displayCompanyName("Inc Magazine"), "Inc Magazine");
});

test("strips a legal designator that sits AFTER a trailing geography parenthetical, exposing it for a second strip", () => {
    assert.equal(displayCompanyName("Extendicare (Canada) Inc."), "Extendicare");
});

// The "+3 more" suffix seen live alongside "Extendicare (Canada) Inc." in
// the reported bug is a SEPARATE UI concatenation (JobDetail.tsx's location
// disclosure toggle, `+ ${hidden.length} more locations`) — verified via
// grep, never part of the string handed to cleanCompany/displayCompanyName,
// so there is nothing for this function to strip.

// Class-wide beyond the reported examples: a DIFFERENT bracketed country
// (not Canada) combined with a geo-gated word ("Group") stacked on top of a
// bare-unconditional one ("Ltd", 2026-08-29 — strips regardless of the
// bracket; see BARE_LEGAL_SUFFIXES's doc). Same final output as before that
// split, composed through two different tiers instead of one.
test("class-wide: a different bracketed country plus a stacked geo-gated word ('Group') and bare designator ('Ltd')", () => {
    assert.equal(displayCompanyName("Acme Widgets (UK) Group Ltd"), "Acme Widgets");
});

// Negative controls for the geo-gated tier: these bare words must NEVER
// strip without a bracketed-geography corroborating signal, even though
// they're in the very same vocabulary the corroborated cases above strip.
test("negative: 'Group' bare, with no geography anywhere, is left alone (not just 'Holdings')", () => {
    assert.equal(displayCompanyName("Riverside Group"), "Riverside Group");
});

test("a trailing parenthetical after a legal form is dropped with it; one after a plain name is kept", () => {
    assert.equal(displayCompanyName("Ingram Micro Inc. (Canada)"), "Ingram Micro");
    assert.equal(displayCompanyName("Prudential Services Asia Sdn Bhd (Malaysia)"), "Prudential Services Asia");
    assert.equal(displayCompanyName("Zenith Freight Pte. Ltd. (Singapore)"), "Zenith Freight");
    assert.equal(displayCompanyName("Canadian Imperial Bank of Commerce (Canada)"), "Canadian Imperial Bank of Commerce (Canada)");
});

// Corp-suffix audit, 2026-08-29: bare "Corp"/"Corporation"/"Ltd" moved out of
// GEO_GATED_TAIL_WORDS into BARE_LEGAL_SUFFIXES — a measured /jobs audit
// found 16.68% of live postings carried a trailing legal suffix but only
// 13.42% got cleaned, and the worst offenders (no bracketed geography, so
// the old gate never fired) were exactly this shape.
test("displayCompanyName strips the reported bug instances: 'Target Corp' and 'NVIDIA Corp'", () => {
    assert.equal(displayCompanyName("Target Corp"), "Target");
    assert.equal(displayCompanyName("NVIDIA Corp"), "NVIDIA");
});

test("displayCompanyName still cleans 'Micron Technology Inc' — no regression on the pre-existing bare-'Inc' path", () => {
    assert.equal(displayCompanyName("Micron Technology Inc"), "Micron Technology");
});

// Class-wide, not just the motivating "Corp" case: a different bare legal
// designator sharing the same widened BARE_LEGAL_SUFFIXES tier must also
// strip unconditionally.
test("displayCompanyName strips a bare 'Ltd' name — proves the split covers the class, not just 'Corp'", () => {
    assert.equal(displayCompanyName("Nimbus Systems Ltd"), "Nimbus Systems");
});

// The module doc's own counter-example for why "Company" stays geo-gated:
// a real employer whose legal name genuinely ends in the word must render
// whole, with no "Company N - " prefix in play this time.
test("displayCompanyName leaves 'The Manufacturers Life Insurance Company' whole — 'Company' stays geo-gated, unlike 'Corp'/'Ltd'", () => {
    assert.equal(
        displayCompanyName("The Manufacturers Life Insurance Company"),
        "The Manufacturers Life Insurance Company",
    );
});

// The bracketed-geography mechanism (Holdings) still composes correctly
// with the now bare-unconditional "Ltd" — same shape/output as the Michael
// Kors case above, on a fresh name to confirm it's not one pinned string.
test("displayCompanyName still strips a geo-bracketed 'Holdings LTD' tail the same as before the split", () => {
    assert.equal(displayCompanyName("Acme (Canada) Holdings LTD"), "Acme");
});

// End-anchoring holds for the newly-widened tokens too, not just "Inc"
// (already covered above) — a name that merely OPENS with "Corp" is never
// touched.
test("displayCompanyName leaves a name that merely OPENS with 'Corp' untouched — end-anchored, not substring", () => {
    assert.equal(displayCompanyName("Corp Solutions"), "Corp Solutions");
});

// Idempotence: re-running displayCompanyName on its own output must be a
// no-op, for both strings it changes and strings it leaves alone.
test("displayCompanyName is idempotent across the full class of inputs above", () => {
    const inputs = [
        "Michael Kors (Canada) Holdings LTD",
        "Stryker Canada ULC",
        "Autodesk Canada Co.",
        "Company 1 - The Manufacturers Life Insurance Company",
        "Greystar Canada Property Management Services",
        "Best Buy",
        "Gap Inc.",
        "Inc Magazine",
        "Extendicare (Canada) Inc.",
        "Acme Widgets (UK) Group Ltd",
        "Riverside Group",
        "Acme Ltd",
        "Acme Corp",
    ];
    for (const input of inputs) {
        const once = displayCompanyName(input);
        assert.equal(displayCompanyName(once), once, `not idempotent for "${input}" -> "${once}"`);
    }
});

// displayCompanyBrand / preferBrandSegment — ATS slogan + brand tails, 2026-08.

test("displayCompanyBrand prefers domain-corroborated brand tail (Prime21 shape)", () => {
    assert.equal(
        displayCompanyBrand("Active Sourcing und Direktansprache und HR Beratung - Prime21", "prime21.de"),
        "Prime21",
    );
});

test("preferBrandSegment drops title-echoed slogan without domain corroboration", () => {
    assert.equal(
        preferBrandSegment(
            "Active Sourcing und Direktansprache und HR Beratung - Prime21",
            null,
            "Trainee Recruitment Consultant IT (all genders) | Active Sourcing und Direktansprache und HR Beratung",
        ),
        "Prime21",
    );
});

test("displayCompanyBrand leaves Goldman Sachs - Investment Banking when last segment ≠ domain brand", () => {
    assert.equal(displayCompanyBrand("Goldman Sachs - Investment Banking", "gs.com"), "Goldman Sachs - Investment Banking");
});

test("displayCompanyBrand does not collapse bilingual duplicates without corroboration (3M audit gap)", () => {
    assert.equal(
        displayCompanyBrand("CAN 3M Canada Company - Compagnie 3M Canada", "3m.com"),
        "CAN 3M Canada Company - Compagnie 3M Canada",
    );
});

test("preferBrandSegment does not split Toronto-Dominion on an internal hyphen", () => {
    assert.equal(preferBrandSegment("The Toronto-Dominion Bank (Canada)", "td.com"), "The Toronto-Dominion Bank (Canada)");
});

// stripBareLegalForm matches the trailing tokens normalised (case, punctuation,
// "." as a separator), so spelling never decides whether a legal form strips.
test("displayCompanyName strips a trailing legal form whatever its punctuation or spacing", () => {
    assert.equal(displayCompanyName("Informa Group Plc."), "Informa Group");
    assert.equal(displayCompanyName("Opella Healthcare IN P.Ltd"), "Opella Healthcare IN");
    assert.equal(displayCompanyName("Foo GmbH."), "Foo");
    assert.equal(displayCompanyName("Acme Pte. Ltd."), "Acme");
    assert.equal(displayCompanyName("Foo Pvt. Ltd"), "Foo");
    assert.equal(displayCompanyName("Bar S.A.S"), "Bar");
});

test("displayCompanyName strips a compound-only word (Pt/P) only when a legal form after it was stripped", () => {
    assert.equal(displayCompanyName("abbott healthcare pt ltd"), "abbott healthcare");
    assert.equal(displayCompanyName("Zeta Labs Pt. Ltd."), "Zeta Labs");
    assert.equal(displayCompanyName("Rapid PT"), "Rapid PT");
    assert.equal(displayCompanyName("Rapid P"), "Rapid P");
    assert.equal(displayCompanyName("PT Ltd"), "PT");
});

test("displayCompanyName keeps bare Co/Company/Group/Holdings and 'AS' unstripped (only the punctuated 'Co.' strips)", () => {
    assert.equal(displayCompanyName("Acme Co"), "Acme Co");
    assert.equal(displayCompanyName("Columbia Sportswear Co"), "Columbia Sportswear Co");
    assert.equal(displayCompanyName("Riverside Group"), "Riverside Group");
    assert.equal(displayCompanyName("Inc Magazine"), "Inc Magazine");
    assert.equal(displayCompanyName("Frontier AS"), "Frontier AS");
    });

test("displayCompanyName never strips a legal form that directly follows '&' or 'and' — it is part of the name", () => {
    assert.equal(displayCompanyName("Smith & Co."), "Smith & Co.");
    assert.equal(displayCompanyName("Levi Strauss & Co."), "Levi Strauss & Co.");
    assert.equal(displayCompanyName("Procter & Gamble Co."), "Procter & Gamble");
    assert.equal(displayCompanyName("Barnes and Noble Inc."), "Barnes and Noble");
    assert.equal(displayCompanyName("Smith and Co."), "Smith and Co.");
});

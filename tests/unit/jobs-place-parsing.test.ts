import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyQueryUnderstanding,
    buildLocationVocabulary,
    parsePlaceTokens,
    PLACE_MIN_COUNT,
} from "../../src/lib/jobs/query-understanding";
import { buildFilter } from "../../src/lib/jobs/meilisearch";

/** Shaped like the live corpus, junk included — every guard below is a value
 *  that actually exists in the index (probed 2026-07-26). */
const DIST = {
    location_city: {
        Toronto: 5183,
        "New York": 13556,
        London: 11919,
        IN: 5613, //           ← the preposition trap
        US: 33031,
        Unknown: 22816,
        "2 Locations": 17547,
        Production: 26, //     ← under the count floor
        Springfield: 1756,
    },
    location_state: {
        Ontario: 4000,
        Remote: 199, //        ← work-mode word in a location field
        California: 16121,
    },
    location_country: {
        Canada: 31424,
        "United States": 683129,
        "United Kingdom": 22788,
        Management: 46, //     ← under the count floor
    },
} as Record<string, Record<string, number>>;

const VOCAB = buildLocationVocabulary(DIST);

test("real places make the vocabulary; every junk class is kept out", () => {
    assert.ok(VOCAB.byText.has("toronto"));
    assert.ok(VOCAB.byText.has("new york"), "multi-word places must be phrases");
    assert.equal(VOCAB.byText.has("production"), false, `count ${DIST.location_city.Production} < ${PLACE_MIN_COUNT}`);
    assert.equal(VOCAB.byText.has("management"), false, "under the count floor");
    assert.equal(VOCAB.byText.has("in"), false, "two-letter tokens collide with English");
    assert.equal(VOCAB.byText.has("us"), false);
    assert.equal(VOCAB.byText.has("unknown"), false, "placeholder, not a place");
    assert.equal(VOCAB.byText.has("2 locations"), false, "digits mean junk");
    assert.equal(VOCAB.byText.has("remote"), false, "the work-type table owns this word");
});

test("aliases resolve to the corpus's canonical value, and only when it exists", () => {
    assert.deepEqual(VOCAB.byText.get("usa"), VOCAB.byText.get("united states"));
    assert.deepEqual(VOCAB.byText.get("uk"), VOCAB.byText.get("united kingdom"));
    const empty = buildLocationVocabulary(null);
    assert.equal(empty.byText.size, 0, "no corpus, no aliases, no vocabulary");
});

test("the screenshot case: 'Technical Account Manager canada' becomes a Canada FILTER, not a content word", () => {
    const { residualQ, places } = parsePlaceTokens("Technical Account Manager canada", VOCAB);
    assert.equal(residualQ, "Technical Account Manager");
    assert.deepEqual(places, [{ field: "location_country", value: "Canada" }]);
});

test("multi-word places match longest-first and leave the rest of the query alone", () => {
    const { residualQ, places } = parsePlaceTokens("senior engineer new york", VOCAB);
    assert.equal(residualQ, "senior engineer");
    assert.deepEqual(places, [{ field: "location_city", value: "New York" }]);
});

test("several places OR together; punctuation between them is irrelevant", () => {
    const { residualQ, places } = parsePlaceTokens("Product Manager - Toronto, Canada", VOCAB);
    assert.equal(residualQ, "Product Manager");
    assert.deepEqual(places, [
        { field: "location_city", value: "Toronto" },
        { field: "location_country", value: "Canada" },
    ]);
    const filter = buildFilter({ q: residualQ, places });
    assert.ok(
        filter.includes('(location_city = "Toronto" OR location_country = "Canada")'),
        `places must be ONE OR group: ${JSON.stringify(filter)}`,
    );
});

test("a query that is only a place browses that place — empty residual, filter set", () => {
    const { residualQ, places } = parsePlaceTokens("toronto", VOCAB);
    assert.equal(residualQ, "");
    assert.equal(places.length, 1);
});

test("place words survive as content when the vocabulary doesn't know them", () => {
    const { residualQ, places } = parsePlaceTokens("product manager lisbon", VOCAB);
    assert.equal(residualQ, "product manager lisbon");
    assert.deepEqual(places, []);
});

test("applyQueryUnderstanding composes: work mode first, then places", () => {
    const p = applyQueryUnderstanding({ q: "remote react developer toronto" }, VOCAB);
    assert.deepEqual(p.facets?.work_type, ["remote"]);
    assert.equal(p.q, "react developer");
    assert.deepEqual(p.places, [{ field: "location_city", value: "Toronto" }]);
});

test("an explicit country facet from the panel wins — typed place tokens stay in the query", () => {
    const p = applyQueryUnderstanding(
        { q: "product manager canada", facets: { location_country: ["United States"] } },
        VOCAB,
    );
    assert.equal(p.q, "product manager canada");
    assert.equal(p.places, undefined);
});

test("no vocabulary means no place parsing — never a crash, never a guess", () => {
    const p = applyQueryUnderstanding({ q: "product manager canada" });
    assert.equal(p.q, "product manager canada");
    assert.equal(p.places, undefined);
});

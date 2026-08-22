import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeRawLocation, locationText, clampLocationSegments } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

const job = (over: Partial<PublicJob>): PublicJob =>
    ({
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: null,
        ...over,
    }) as PublicJob;

test("a JSON-blob location renders as its readable parts, never as raw JSON", () => {
    // Verbatim from a production row, 2026-07-26 (Valsoft Corporation).
    const blob = '{"country":"Canada","countryCode":"CA","city":"","region":null}';
    assert.equal(humanizeRawLocation(blob), "Canada");
    assert.equal(locationText(job({ location: blob })), "Canada");
});

test("city and region survive when the blob carries them", () => {
    assert.equal(
        humanizeRawLocation('{"country":"Canada","city":"Toronto","region":"Ontario"}'),
        "Toronto, Ontario, Canada",
    );
});

test("'[object Object]' is junk — fall through to the structured fields", () => {
    // Verbatim from a production row, 2026-07-26 (Toolbx).
    assert.equal(humanizeRawLocation("[object Object]"), null);
    assert.equal(
        locationText(job({ location: "[object Object]", location_country: "Canada" })),
        "Canada",
    );
    assert.equal(locationText(job({ location: "[object Object]" })), "Location not listed");
});

test("junk in the STRUCTURED fields is filtered too — the Toolbx doc holds it in location_city", () => {
    // Retrieved live 2026-07-26: location AND location_city both "[object Object]".
    assert.equal(
        locationText(job({ location: "[object Object]", location_city: "[object Object]" })),
        "Location not listed",
    );
    assert.equal(
        locationText(job({ location_city: "[object Object]", location_country: "Canada" })),
        "Canada",
    );
});

test("a JSON array of place names joins readably", () => {
    assert.equal(humanizeRawLocation('["Toronto","Vancouver"]'), "Toronto, Vancouver");
});

test("structural-looking but unparseable strings are junk, not display text", () => {
    assert.equal(humanizeRawLocation("{country: Canada"), null);
    assert.equal(
        locationText(job({ location: "{broken", location_city: "Berlin" })),
        "Berlin",
    );
});

test("an all-empty blob falls through rather than rendering an empty line", () => {
    assert.equal(humanizeRawLocation('{"city":"","region":null}'), null);
    assert.equal(
        locationText(job({ location: '{"city":""}', work_type: "remote" })),
        "Remote",
    );
});

test("ordinary prose locations pass through untouched", () => {
    assert.equal(humanizeRawLocation("Toronto, Ontario"), "Toronto, Ontario");
    assert.equal(locationText(job({ location: "Remote - EMEA" })), "Remote - EMEA");
});

test("a plain string location_country renders byte-identical to today", () => {
    assert.equal(locationText(job({ location_country: "Canada" })), "Canada");
    assert.equal(
        locationText(job({ location_city: "Toronto", location_country: "Canada" })),
        "Toronto, Canada",
    );
});

test("an array location_country joins its distinct values into one readable string", () => {
    assert.equal(
        locationText(job({ location_country: ["United States", "Canada"] })),
        "United States, Canada",
    );
    assert.equal(
        locationText(job({ location_country: ["Canada", "Canada"] })),
        "Canada",
    );
});

test("an empty array and a null location_country both fall through the same as today's empty case", () => {
    assert.equal(
        locationText(job({ location_country: [] })),
        "Location not listed",
    );
    assert.equal(
        locationText(job({ location_country: null })),
        "Location not listed",
    );
    assert.equal(
        locationText(job({ location_country: [], work_type: "remote" })),
        "Remote",
    );
});

// Progressive-disclosure clamp for the JobDetail identity-header location
// line (2026-08-20) — an aggregator posting's `location` string can be a
// semicolon-joined dump of many entries; `locationText` passes it through
// verbatim (see `humanizeRawLocation` above), so the clamp lives one layer
// up as its own pure decision rather than teaching `locationText` about
// rendering.
test("3 or fewer segments render in full — no clamp, matches today's behavior", () => {
    assert.deepEqual(clampLocationSegments("Remote"), { visible: ["Remote"], hidden: [] });
    assert.deepEqual(clampLocationSegments("San Diego; Remote - CA; Remote - AZ"), {
        visible: ["San Diego", "Remote - CA", "Remote - AZ"],
        hidden: [],
    });
});

test("exactly 4 segments clamps to the first 2, hides the rest", () => {
    const result = clampLocationSegments("A; B; C; D");
    assert.deepEqual(result, { visible: ["A", "B"], hidden: ["C", "D"] });
});

test("a single plain location with no semicolons behaves exactly as today", () => {
    assert.deepEqual(clampLocationSegments("San Diego, CA"), { visible: ["San Diego, CA"], hidden: [] });
});

test("whitespace around semicolons is trimmed and empty segments are dropped", () => {
    assert.deepEqual(clampLocationSegments("  A  ;B;  ;C ;D;E"), {
        visible: ["A", "B"],
        hidden: ["C", "D", "E"],
    });
});

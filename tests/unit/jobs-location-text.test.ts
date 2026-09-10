import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeRawLocation, locationText, clampLocationSegments, stripStreetAddress } from "../../src/lib/jobs/presentation";
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

// A1 audit defect (2026-09-09 prod screenshot): a full mailing address in the
// `location` field reads as several distinct "locations" downstream
// (comma-joined breadcrumb -> `locationSummary` sees 4+ segments and prints
// "626 Polymoore Drive +3 more"). `stripStreetAddress` drops the house
// number / unit / postal-code parts BEFORE that ever happens, and
// `locationText` runs it on both the raw string and each structured field.
test("strips a Canadian street address down to city, province, country", () => {
    assert.equal(
        stripStreetAddress("626 Polymoore Drive, Corunna, ON N0N 1G0, Canada"),
        "Corunna, ON, Canada",
    );
    assert.equal(
        locationText(job({ location: "626 Polymoore Drive, Corunna, ON N0N 1G0, Canada" })),
        "Corunna, ON, Canada",
    );
});

test("strips a highway-numbered street address (house number carries a letter suffix)", () => {
    assert.equal(
        locationText(job({ location: "23520 Hwy 16A, Sherwood Park, AB T8A 4Y3, Canada" })),
        "Sherwood Park, AB, Canada",
    );
});

test("drops a suite/unit marker as its own segment, not just the street line", () => {
    assert.equal(
        locationText(job({ location: "1700 Pacific Avenue, Suite 200, Dallas, TX 75201, United States" })),
        "Dallas, TX, United States",
    );
});

test("strips a UK postcode glued onto the city segment", () => {
    assert.equal(locationText(job({ location: "London EC1A 1BB, UK" })), "London, UK");
});

test("a location with no street-address parts at all is untouched", () => {
    assert.equal(
        locationText(job({ location: "Halifax, Nova Scotia, Canada" })),
        "Halifax, Nova Scotia, Canada",
    );
});

test("a semicolon-joined multi-location string with no addresses in it is untouched", () => {
    assert.equal(
        locationText(job({ location: "Remote Canada; Remote USA" })),
        "Remote Canada; Remote USA",
    );
});

// Live prod row (2026-09-09, Home Depot Canada listing): a retailer's own
// store number glued onto the city with a dash, not a comma, so it never
// becomes its own segment for `STREET_BARE_NUMBER_RE` to drop — the same
// "junk digits" class, a different join character.
test("strips a dash-joined trailing store number, but not a dash-joined remote qualifier", () => {
    assert.equal(
        locationText(job({ location: "PENNANT PARK, ATLANTA - 9141", work_type: "hybrid" })),
        "Pennant Park, Atlanta",
    );
    assert.equal(locationText(job({ location: "Remote - EMEA" })), "Remote - EMEA");
});

// Full path through locationText for the titleCaseDisplay class defect
// (fixed alongside the A1 street-address strip, same commit series): an
// all-caps raw location with a Canadian postal code must both lose the
// postal code AND come out with the province code intact, not lowercased.
test("an all-caps raw location strips its postal code and keeps the province code intact", () => {
    assert.equal(
        locationText(job({ location: "TORONTO, ON M5V 3L9, CANADA" })),
        "Toronto, ON, Canada",
    );
});

test("a bare street address with nothing else falls through to the structured fields", () => {
    assert.equal(locationText(job({ location: "10 Downing Street" })), "Location not listed");
    assert.equal(
        locationText(
            job({ location: "10 Downing Street", location_city: "London", location_country: "United Kingdom" }),
        ),
        "London, United Kingdom",
    );
});

// Every surface rendering `locationText` also renders `work_type` as its
// own adjacent chip/fact (row chip row, detail meta line), so a remote
// job's place text must NOT repeat "Remote" — that duplicated the word in
// one line ("📍 Remote · Milan, Italy · Remote · Full Time").
test("a remote job's location is the place only, never 'Remote'-prefixed", () => {
    assert.equal(locationText(job({ location: "Toronto, ON", work_type: "remote" })), "Toronto, ON");
    assert.equal(
        locationText(job({ location_city: "Toronto", location_country: "Canada", work_type: "remote" })),
        "Toronto, Canada",
    );
});

test("a remote job with no location text at all still falls back to the word 'Remote'", () => {
    assert.equal(locationText(job({ location: "", work_type: "remote" })), "Remote");
});

test("a hybrid job's location is unaffected by the remote-prefix removal", () => {
    assert.equal(locationText(job({ location: "Austin, TX", work_type: "hybrid" })), "Austin, TX");
});

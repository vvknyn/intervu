import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCardPlace } from "../../src/lib/presentation/job";
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

test("resolved city, region and country win over the raw ATS string", () => {
    assert.equal(
        formatCardPlace(
            job({
                location: "CA-AB-Calgary-Gulf Canada Square",
                location_city: "Calgary",
                location_state: "Alberta",
                location_country: "Canada",
            }),
        ),
        "Calgary, Alberta, Canada",
    );
});

test("a second tenant's breadcrumb gets the same treatment", () => {
    assert.equal(
        formatCardPlace(
            job({
                location: "US-TX-Austin-Domain Tower 3rd Floor",
                location_city: "Austin",
                location_state: "Texas",
                location_country: "United States",
            }),
        ),
        "Austin, Texas, United States",
    );
});

test("partial fields print what resolved", () => {
    assert.equal(formatCardPlace(job({ location: "EMEA-Remote-x", location_country: "Germany" })), "Germany");
    assert.equal(
        formatCardPlace(job({ location: "junk", location_city: "Austin", location_country: "United States" })),
        "Austin, United States",
    );
});

test("nothing resolved falls back to the cleaned raw string", () => {
    assert.equal(formatCardPlace(job({ location: "Vancouver, BC, Canada" })), "Vancouver, BC, Canada");
});

test("nothing at all: remote stays Remote, otherwise the unknown sentinel", () => {
    assert.equal(formatCardPlace(job({ work_type: "remote" })), "Remote");
    assert.equal(formatCardPlace(job({})), "Location not listed");
});

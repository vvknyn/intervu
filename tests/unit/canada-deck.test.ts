import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCanadaDeckJob } from "../../src/lib/jobs/for-you/canada-deck";

const base = {
    company: "Northbeam",
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
};

describe("isCanadaDeckJob", () => {
    it("drops raw ATS breadcrumbs that say CAN without a country field", () => {
        assert.equal(isCanadaDeckJob({ ...base, location: "CAN - ON - Toronto" }), true);
        assert.equal(isCanadaDeckJob({ ...base, location: "Toronto, Ontario, Canada" }), true);
    });

    it("drops location_country Canada and the existing CA country code", () => {
        assert.equal(isCanadaDeckJob({ ...base, location_country: "Canada" }), true);
        assert.equal(isCanadaDeckJob({ ...base, location_country: "CA" }), true);
        assert.equal(isCanadaDeckJob({ ...base, location_country: "CAN" }), true);
    });

    it("keeps US places, including California", () => {
        assert.equal(
            isCanadaDeckJob({
                ...base,
                location: "San Francisco, CA",
                location_city: "San Francisco",
                location_state: "CA",
                location_country: "United States",
            }),
            false,
        );
        assert.equal(
            isCanadaDeckJob({ ...base, location: "Austin, TX", location_country: "United States" }),
            false,
        );
    });
});

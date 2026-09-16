import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveResumeLocationFacets } from "../../src/lib/jobs/resume-location";

describe("deriveResumeLocationFacets", () => {
    it("Richmond Hill, Ontario → Canada only", () => {
        assert.deepEqual(deriveResumeLocationFacets("Richmond Hill, Ontario"), {
            location_country: ["Canada"],
        });
    });

    it("Toronto, Canada → Canada", () => {
        assert.deepEqual(deriveResumeLocationFacets("Toronto, Canada"), {
            location_country: ["Canada"],
        });
    });

    it("empty / missing → {}", () => {
        assert.deepEqual(deriveResumeLocationFacets(""), {});
        assert.deepEqual(deriveResumeLocationFacets(null), {});
        assert.deepEqual(deriveResumeLocationFacets(undefined), {});
    });

    it("does not return location_city", () => {
        const facets = deriveResumeLocationFacets("Richmond Hill, Ontario");
        assert.equal("location_city" in facets, false);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveResumeLocationFacets, jobCountries, resumeCountriesFromLocation } from "../../src/lib/jobs/resume-location";
import type { PublicJob } from "../../src/lib/jobs/types";

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

describe("ISO alpha-3 country codes", () => {
    it("reads capitalised three-letter codes, country first or last, on any site", () => {
        const job = (location: string) => ({ location, location_city: null, location_state: null, location_country: null }) as unknown as PublicJob;
        assert.deepEqual(jobCountries(job("CAN, BC, Vancouver")), ["Canada"]);
        assert.deepEqual(jobCountries(job("IND, KA, Bangalore")), ["India"]);
        assert.deepEqual(jobCountries(job("GBR, London")), ["United Kingdom"]);
        assert.deepEqual(jobCountries(job("Berlin, DEU")), ["Germany"]);
        assert.deepEqual(jobCountries({ ...job(""), location_country: "ARE" } as PublicJob), ["United Arab Emirates"]);
    });
    it("leaves lowercase three-letter words alone", () => {
        assert.deepEqual(resumeCountriesFromLocation("Springfield, and"), []);
        assert.deepEqual(resumeCountriesFromLocation("per diem, ind"), []);
    });
});

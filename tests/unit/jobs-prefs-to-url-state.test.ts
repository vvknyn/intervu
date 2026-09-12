import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { SearchPreferences } from "@/lib/agent/preferences";
import { buildMatchQuery } from "@/lib/jobs/resume-match";
import {
    draftSearchPreferencesFromResume,
    isAutoPersonalizeUrl,
    isPristineJobsUrlState,
    locationFacetsFromSearchPreferences,
    mergePrefsWithRankPhrases,
    searchPreferencesToJobsUrlState,
    workTypesFromSearchPreferences,
} from "@/lib/jobs/prefs-to-url-state";
import { DEFAULT_URL_STATE, parseJobsUrl, serializeJobsUrl } from "@/lib/jobs/url-state";
import type { ResumeData } from "@/types/resume";

const sampleResume: ResumeData = {
    profile: {
        name: "Test User",
        profession: "Technical Account Manager",
        location: "Toronto, Canada",
        yearsOfExperience: 8,
    },
    experience: [{ role: "Technical Account Manager", company: "Acme", duration: "2020–2024", highlights: [] }],
    competencies: [{ category: "Skills", skills: ["SaaS", "APIs"] }],
};

describe("searchPreferencesToJobsUrlState", () => {
    it("maps location to country facets via deriveResumeLocationFacets", () => {
        const out = searchPreferencesToJobsUrlState({ location: "Toronto, Canada" });
        assert.deepEqual(out.facets?.location_country, ["Canada"]);
    });

    it("pref location wins over résumé location fallback", () => {
        const out = searchPreferencesToJobsUrlState(
            { location: "Austin, Texas" },
            { resumeLocation: "Toronto, Canada" },
        );
        assert.deepEqual(out.facets?.location_country, ["United States"]);
    });

    it("uses résumé location fallback when prefs.location empty", () => {
        const out = searchPreferencesToJobsUrlState({}, { resumeLocation: "Toronto, Canada" });
        assert.deepEqual(out.facets?.location_country, ["Canada"]);
    });

    it("remoteOnly maps to work_type remote", () => {
        const out = searchPreferencesToJobsUrlState({ remoteOnly: true });
        assert.deepEqual(out.facets?.work_type, ["remote"]);
    });

    it("workMode wins over remoteOnly", () => {
        const out = searchPreferencesToJobsUrlState({ workMode: "hybrid", remoteOnly: true });
        assert.deepEqual(out.facets?.work_type, ["hybrid"]);
    });

    it("maps salary floor", () => {
        const out = searchPreferencesToJobsUrlState({ salaryMin: 120_000 });
        assert.equal(out.salaryMin, 120_000);
    });

    it("maps postedWithinDays to posted bucket", () => {
        const out = searchPreferencesToJobsUrlState({ postedWithinDays: 7 });
        assert.equal(out.postedBucket, "7d");
        assert.equal(out.postedExplicit, true);
    });

    it("drops invalid experienceLevel and employmentType", () => {
        const out = searchPreferencesToJobsUrlState({
            experienceLevel: "typo_level",
            employmentType: "not_a_type",
        });
        assert.equal(out.facets?.experience_level, undefined);
        assert.equal(out.facets?.employment_type, undefined);
    });

    it("keeps vocab-valid seniority and employment type", () => {
        const out = searchPreferencesToJobsUrlState({
            experienceLevel: "senior",
            employmentType: "full_time",
        });
        assert.deepEqual(out.facets?.experience_level, ["senior"]);
        assert.deepEqual(out.facets?.employment_type, ["full_time"]);
    });

    it("backward compat: old SearchPreferences shapes still map", () => {
        const legacy: SearchPreferences = {
            query: "backend engineer",
            location: "Remote, Canada",
            remoteOnly: true,
            salaryMin: 100_000,
        };
        const out = searchPreferencesToJobsUrlState(legacy);
        assert.equal(out.q, "backend engineer");
        assert.deepEqual(out.facets?.work_type, ["remote"]);
        assert.equal(out.salaryMin, 100_000);
    });
});

describe("mergePrefsWithRankPhrases", () => {
    it("merges prefs facets with Rank phrases — q from buildMatchQuery", () => {
        const rank = buildMatchQuery(sampleResume);
        const prefs = searchPreferencesToJobsUrlState(
            { salaryMin: 90_000, experienceLevel: "senior", remoteOnly: true },
            { resumeLocation: sampleResume.profile?.location },
        );
        const merged = mergePrefsWithRankPhrases(prefs, rank);
        assert.ok(merged.q && merged.q.length > 0);
        assert.equal(merged.sort, "fit");
        assert.deepEqual(merged.facets?.work_type, ["remote"]);
        assert.deepEqual(merged.facets?.experience_level, ["senior"]);
        assert.equal(merged.salaryMin, 90_000);
    });

    it("uses prefs query only when Rank q is empty", () => {
        const rank = buildMatchQuery({ profile: {}, experience: [], competencies: [] });
        const prefs = searchPreferencesToJobsUrlState({ query: "product manager" });
        const merged = mergePrefsWithRankPhrases(prefs, rank);
        assert.equal(merged.q, "product manager");
    });
});

describe("workTypesFromSearchPreferences", () => {
    it("parses remote from location string", () => {
        assert.deepEqual(workTypesFromSearchPreferences({ location: "remote canada" }), ["remote"]);
    });
});

describe("locationFacetsFromSearchPreferences", () => {
    it("strips work mode before country derivation", () => {
        const facets = locationFacetsFromSearchPreferences({ location: "remote Canada" });
        assert.deepEqual(facets.location_country, ["Canada"]);
    });
});

describe("isPristineJobsUrlState / isAutoPersonalizeUrl", () => {
    it("bare /jobs is pristine", () => {
        assert.equal(isPristineJobsUrlState(DEFAULT_URL_STATE), true);
        assert.equal(isPristineJobsUrlState(parseJobsUrl(new URLSearchParams(""))), true);
    });

    it("deliberate query is not pristine", () => {
        const state = { ...DEFAULT_URL_STATE, q: "engineer" };
        assert.equal(isPristineJobsUrlState(state), false);
    });

    it("sort=fit only is auto-personalize safe", () => {
        const state = { ...DEFAULT_URL_STATE, sort: "fit" as const };
        assert.equal(isAutoPersonalizeUrl(state), true);
    });
});

describe("draftSearchPreferencesFromResume", () => {
    it("prefills location and seniority from résumé", () => {
        const draft = draftSearchPreferencesFromResume({
            location: "Remote, Canada",
            yearsOfExperience: 8,
            profession: "TAM",
        });
        assert.equal(draft.location, "Remote, Canada");
        assert.equal(draft.workMode, "remote");
        assert.equal(draft.experienceLevel, "senior");
        assert.equal(draft.query, "TAM");
    });
});

describe("openToAdjacentRoles", () => {
    it("widens Rank phrase cap when enabled", () => {
        const base = buildMatchQuery(sampleResume);
        const wide = buildMatchQuery(sampleResume, { openToAdjacentRoles: true });
        assert.ok((wide.phrases?.length ?? 0) >= (base.phrases?.length ?? 0));
    });
});

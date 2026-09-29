import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET as locationsGet } from "../../src/app/api/jobs/locations/route";
import { CITY_PLACE_LABELS_MAX, cityPlaceLabels, loadGazetteer } from "../../src/lib/geo/gazetteer";
import { countriesOfPlace } from "../../src/lib/jobs/candidate-signals";
import { loaded, loadFailed } from "../../src/lib/load-result";
import { normalizeParsedResume } from "../../src/lib/resume/normalize-parsed-resume";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import { findPlaceToConfirm, placesToConfirm, settlePlace } from "../../src/lib/resume/unconfirmed-place";
import type { ResumeData } from "../../src/types/resume";

/**
 * Vivek, Sep 28: "Bare-city résumés: confirm with user". A contact line's
 * bare city stays out of `location` (no filter) and becomes a one-tap
 * question whose candidates are every place the gazetteer knows by that name.
 */

const BODY = ["EXPERIENCE", "Acme Corporation", "Senior Engineer", "Jan 2020 - Present", "• Built things"];
const parse = (...header: string[]) => structureResumeText(["Jane Doe", "Software Engineer", ...header, ...BODY].join("\n")).profile;

const gazetteer = loadGazetteer();
const fromGazetteer = async (name: string) => loaded(cityPlaceLabels(name, gazetteer));
/** The whole import path, résumé text → the question the user sees (null = no prompt). */
async function questionFor(...header: string[]) {
    const { profile } = normalizeParsedResume({ profile: parse(...header) }).parsed;
    return findPlaceToConfirm(placesToConfirm(profile), fromGazetteer);
}

describe("bare-city résumé → confirm question", () => {
    it("Canadian bare city (not Toronto): one place, asked as yes/no, no location until then", async () => {
        const profile = parse("Mississauga | jane@example.com | 416-555-0199");
        assert.equal(profile.location, "");
        assert.deepEqual(profile.unconfirmedPlaces, ["Mississauga"]);
        assert.deepEqual(await questionFor("Mississauga | jane@example.com | 416-555-0199"), {
            name: "Mississauga",
            places: ["Mississauga, Ontario, Canada"],
        });
    });

    it("US bare city beside a LinkedIn URL", async () => {
        assert.deepEqual(await questionFor("linkedin.com/in/janedoe · Pittsburgh"), {
            name: "Pittsburgh",
            places: ["Pittsburgh, Pennsylvania, United States"],
        });
    });

    it("ambiguous name: every candidate, no pick — London spans three countries", async () => {
        const q = await questionFor("jane@example.com | London");
        assert.equal(q?.name, "London");
        assert.ok(q!.places.length > 1);
        for (const place of ["London, England, United Kingdom", "London, Ontario, Canada", "London, Ohio, United States"]) {
            assert.ok(q!.places.includes(place), place);
        }
    });

    it("a dozen Springfields are offered as the largest few, never one picked", () => {
        const places = cityPlaceLabels("Springfield", gazetteer);
        assert.equal(places.length, CITY_PLACE_LABELS_MAX);
        assert.equal(new Set(places).size, places.length);
        assert.ok(places.every((p) => /^Springfield, .+, United States$/.test(p)));
    });

    it("a non-place word asks nothing", async () => {
        assert.deepEqual(parse("jane@example.com | TypeScript").unconfirmedPlaces, ["TypeScript"]);
        assert.equal(await questionFor("jane@example.com | TypeScript"), null);
    });

    it("a full City, Region line is the location and asks nothing", async () => {
        const profile = parse("Toronto, ON | jane@example.com");
        assert.equal(profile.location, "Toronto, ON");
        assert.equal("unconfirmedPlaces" in profile, false);
        assert.equal(await questionFor("Toronto, ON | jane@example.com"), null);
    });

    it("name and headline lines carry no contact data, so they are never asked about", () => {
        const profile = structureResumeText(["Austin", "Product Manager", "jane@example.com", ...BODY].join("\n")).profile;
        assert.equal("unconfirmedPlaces" in profile, false);
    });

    it("a failed read asks nothing; a later known name is still asked", async () => {
        assert.equal(await findPlaceToConfirm(["Mississauga"], async () => loadFailed("HTTP 429")), null);
        const q = await findPlaceToConfirm(["TypeScript", "Calgary"], fromGazetteer);
        assert.deepEqual(q, { name: "Calgary", places: ["Calgary, Alberta, Canada"] });
    });
});

describe("the answer", () => {
    const resume = (profile: Partial<ResumeData["profile"]>): ResumeData => ({
        profile: { name: "", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "", ...profile },
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: "",
    });

    it("confirmed: the chosen place is the location, and it now yields the country filter", () => {
        const next = settlePlace(resume({ unconfirmedPlaces: ["Mississauga"] }), "Mississauga, Ontario, Canada");
        assert.equal(next.profile.location, "Mississauga, Ontario, Canada");
        assert.equal("unconfirmedPlaces" in next.profile, false, "no undefined-valued key reaches the save");
        assert.deepEqual(countriesOfPlace(next.profile.location), ["Canada"]);
        assert.deepEqual(placesToConfirm(next.profile), []);
    });

    it("dismissed: location stays blank and the question is not asked again", () => {
        const next = settlePlace(resume({ unconfirmedPlaces: ["London"] }), "");
        assert.equal(next.profile.location, "");
        assert.deepEqual(placesToConfirm(next.profile), []);
    });

    it("a location set any other way wins — nothing left to confirm", () => {
        assert.deepEqual(placesToConfirm(resume({ location: "Toronto, ON", unconfirmedPlaces: ["Toronto"] }).profile), []);
    });

    it("unconfirmed places survive normalization; an empty list writes no key", () => {
        const kept = normalizeParsedResume({ profile: { unconfirmedPlaces: ["Mississauga"] } }).parsed.profile;
        assert.deepEqual(kept.unconfirmedPlaces, ["Mississauga"]);
        const none = normalizeParsedResume({ profile: { unconfirmedPlaces: [] } }).parsed.profile;
        assert.equal("unconfirmedPlaces" in none, false);
    });
});

describe("GET /api/jobs/locations — places", () => {
    it("answers a bare city with its gazetteer places, and a non-place with none", async () => {
        const get = async (q: string) =>
            (await (await locationsGet(new Request(`http://x/api/jobs/locations?q=${q}`, { headers: { "x-forwarded-for": "203.0.113.29" } }))).json()) as {
                places: string[];
            };
        assert.deepEqual((await get("Mississauga")).places, ["Mississauga, Ontario, Canada"]);
        assert.deepEqual((await get("TypeScript")).places, []);
    });
});

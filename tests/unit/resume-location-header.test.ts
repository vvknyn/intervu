import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLocation } from "../../src/lib/resume/contact-line";
import { locationFromResumePlainText, structureResumeText } from "../../src/lib/resume/structure-resume-text";

const BODY = ["EXPERIENCE", "Acme Corporation", "Senior Engineer", "Jan 2020 - Present", "• Built things"];
const resume = (header: string[]) => ["Jane Doe", ...header, ...BODY].join("\n");
/** Header rows whose place is recognised by structure: a region/country part, an "… Area" name, or a label / work-mode qualifier. */
const POSITIVE: { name: string; header: string[]; expect: string }[] = [
    { name: "pipe row", header: ["Toronto, ON | jane@example.com | 416-555-0199"], expect: "Toronto, ON" },
    { name: "Location: label", header: ["Location: Vancouver, BC"], expect: "Vancouver, BC" },
    { name: "Based in label", header: ["Based in Berlin, Germany"], expect: "Berlin, Germany" },
    { name: "street address + postal", header: ["Address: 123 Main St, Toronto, ON M5V 2T6"], expect: "Toronto, ON" },
    { name: "Remote — place", header: ["Remote — Austin, TX"], expect: "Austin, TX" },
    { name: "Remote — bare city", header: ["Remote — Mississauga | jane@example.com"], expect: "Mississauga" },
    { name: "Location: bare city", header: ["Location: Pune"], expect: "Pune" },
    { name: "On-site, place, country", header: ["On-site · Kraków, Poland"], expect: "Kraków, Poland" },
    { name: "Remote (place)", header: ["Remote (Austin, TX)"], expect: "Austin, TX" },
    { name: "place (Remote)", header: ["Austin, TX (Remote)"], expect: "Austin, TX" },
    { name: "Hybrid · place · email", header: ["Hybrid · Seattle, WA · jane@example.com"], expect: "Seattle, WA" },
    { name: "US ZIP", header: ["San Francisco, CA 94105 | (415) 555-0100"], expect: "San Francisco, CA" },
    { name: "title | place", header: ["Product Manager | Denver, CO | jane@example.com"], expect: "Denver, CO" },
    { name: "name — place on one line", header: ["Jane Doe — Calgary, Alberta"], expect: "Calgary, Alberta" },
    { name: "pin emoji", header: ["📍 Dubai, UAE"], expect: "Dubai, UAE" },
    { name: "UK", header: ["London, UK | jane@example.com"], expect: "London, UK" },
    { name: "UK postcode", header: ["Manchester, UK, M1 1AE"], expect: "Manchester, UK" },
    { name: "India three-part", header: ["Bengaluru, Karnataka, India"], expect: "Bengaluru, Karnataka, India" },
    { name: "area suffix", header: ["Greater Toronto Area"], expect: "Greater Toronto Area" },
    { name: "São Paulo (non-ASCII)", header: ["São Paulo, Brazil"], expect: "São Paulo, Brazil" },
    { name: "Zürich (non-ASCII)", header: ["Zürich, Switzerland"], expect: "Zürich, Switzerland" },
    { name: "Montréal (non-ASCII)", header: ["Montréal, QC"], expect: "Montréal, QC" },
    { name: "Kraków (non-ASCII)", header: ["Kraków, Poland"], expect: "Kraków, Poland" },
    { name: "city, country not on the built-in list", header: ["Lagos, Nigeria"], expect: "Lagos, Nigeria" },
];

/**
 * A bare city, or a place whose country is not named in English, needs a
 * dictionary (the 4 MB gazetteer is server-only), so the location stays
 * empty — never a guess. A bare city on a contact line becomes a question
 * for the user instead (resume-bare-city-confirm.test.ts).
 */
const UNRECOGNISED: { name: string; header: string[] }[] = [
    { name: "CJK", header: ["東京, 日本"] },
    { name: "Cyrillic", header: ["Москва, Россия"] },
    { name: "bare city", header: ["Mississauga"] },
    { name: "bare non-ASCII city", header: ["Zürich"] },
    { name: "bare two-word city", header: ["Buenos Aires", "jane@example.com"] },
    { name: "bare city after title", header: ["Data Scientist", "Nairobi | jane@example.com"] },
];

const NEGATIVE: { name: string; header: string[] }[] = [
    { name: "job title", header: ["Senior Product Manager"] },
    { name: "title with comma", header: ["Software Engineer, Backend"] },
    { name: "company", header: ["Acme Corporation"] },
    { name: "company with Inc.", header: ["Stripe, Inc."] },
    { name: "date range", header: ["Jan 2020 - Present"] },
    { name: "month-year", header: ["May 2019"] },
    { name: "graduation line", header: ["Bachelor of Science, 2016"] },
    { name: "skills list", header: ["Python, SQL, React"] },
    { name: "email + phone only", header: ["jane@example.com | 416-555-0199"] },
    { name: "url only", header: ["linkedin.com/in/janedoe | janedoe.dev"] },
    { name: "Remote alone", header: ["Remote"] },
    { name: "single-word title", header: ["Consultant"] },
];

describe("résumé header location", () => {
    for (const c of POSITIVE) {
        it(`${c.name}: ${JSON.stringify(c.header[0])}`, () => {
            const text = resume(c.header);
            assert.equal(locationFromResumePlainText(text), c.expect);
            assert.equal(structureResumeText(text).profile.location, c.expect);
        });
    }

    for (const c of [...UNRECOGNISED, ...NEGATIVE]) {
        it(`empty — ${c.name}`, () => {
            assert.equal(locationFromResumePlainText(resume(c.header)), "");
        });
    }

    it("a company line in the experience body is never a bare city", () => {
        const text = ["Jane Doe", "Product Manager", "EXPERIENCE", "Orange", "Product Manager", "Jan 2020 - Present"].join("\n");
        assert.equal(locationFromResumePlainText(text), "");
    });

    it("the name line is not a place even when it names a city", () => {
        assert.equal(locationFromResumePlainText(["Austin", "Product Manager", ...BODY].join("\n")), "");
    });
});

describe("sanitizeLocation", () => {
    const cases: [string, string][] = [
        ["Location: Vancouver, BC", "Vancouver, BC"],
        ["Remote — Austin, TX", "Austin, TX"],
        ["Remote (Austin, TX)", "Austin, TX"],
        ["Zürich, Switzerland", "Zürich, Switzerland"],
        ["Mississauga", "Mississauga"],
        ["Richmond Hill, Ontario", "Richmond Hill, Ontario"],
        ["Toronto, ON jane@example.com", ""],
        ["Toronto, ON 416-555-0199", ""],
        ["Toronto, ON, 2019", ""],
        ["Toronto, ON | Jan 2020", ""],
        ["toronto.ca", ""],
        ["Remote", ""],
        ["into prioritized, shippable roadmaps.", ""],
        ["", ""],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            assert.equal(sanitizeLocation(input), expected);
        });
    }
});

/**
 * Résumé PDF thread finding (2026-10-02): "Amara Okafor, RN" above
 * "Hamilton, ON | email" parsed as the location "Amara Okafor, RN", because
 * "RN" reads like a state code and the longest place won. The location drives
 * ranking and the abroad picks.
 */
describe("a name line with credentials is never the location", () => {
    const BODY_LINES = ["EXPERIENCE", "Registered Nurse | Hamilton Health | 2019 – Present", "- Cared for patients"];
    const parse = (header: string[]) => structureResumeText([...header, ...BODY_LINES].join("\n")).profile;
    const location = (header: string[]) => locationFromResumePlainText([...header, ...BODY_LINES].join("\n"));

    it("RN after the name, place on the next line", () => {
        const profile = parse(["Amara Okafor, RN", "Hamilton, ON | amara@example.com | (905) 555-0100"]);
        assert.equal(profile.location, "Hamilton, ON");
        assert.equal(profile.name, "Amara Okafor");
    });

    it("name, credentials and place on one contact row", () => {
        assert.equal(location(["Amara Okafor, RN | Hamilton, ON | amara@example.com"]), "Hamilton, ON");
    });

    it("credentials and no place leave the location empty", () => {
        assert.equal(location(["Priya Shah, PhD, MD", "priya@example.com"]), "");
        assert.equal(location(["Amara Okafor, RN, BSN | amara@example.com"]), "");
    });

    it("a degree that is also a state code after an honorific", () => {
        assert.equal(location(["Dr. Ana Lima, MD", "São Paulo, SP | ana@example.com"]), "São Paulo, SP");
    });

    it("a place whose country is known beats a longer one whose isn't", () => {
        assert.equal(location(["Christopher Johnson, MD | chris@example.com", "Austin, TX"]), "Austin, TX");
    });

    it("credentials before a place on the name line", () => {
        assert.equal(location(["Priya Shah, PhD, MD | Toronto, ON"]), "Toronto, ON");
    });

    it("a name before a dash keeps the place after it, and the name stops at the dash", () => {
        const profile = parse(["Jane Doe — Calgary, Alberta", "jane@example.com"]);
        assert.equal(profile.location, "Calgary, Alberta");
        assert.equal(profile.name, "Jane Doe");
    });

    // A name in capitals isn't name-shaped, so a two-word place below it can be
    // taken for the name line; its region code must still read as a place.
    for (const place of ["San Francisco, CA", "Richmond Hill, Ontario", "Greater Noida, UP", "Kansas City, MO"]) {
        it(`a name-shaped place stays the location: ${place}`, () => {
            assert.equal(location(["JANE DOE", place, "jane@example.com"]), place);
        });
    }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    CONTENT_FAMILY_MIN_MARGIN,
    CONTENT_FAMILY_MIN_TERMS,
    contentFamilyLabel,
    isWorkWord,
    postingContentFamily,
    resumeContentFamilies,
} from "../../src/lib/match/content-family";
import { FAMILY_LEXICON } from "../../src/lib/match/family-lexicon";
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import {
    CONTENT_LED_MIN_EVIDENCE,
    CONTENT_LED_MIN_FIT,
    JD_GOOD_MIN_FIT,
    MATCH_BAND_GOOD_MIN,
    roleAffinity,
    scoreJobAgainstResume,
    workTerms,
    workWeight,
    type MatchScore,
} from "../../src/lib/match/score";
import { explainMatch } from "../../src/lib/match/explain";
import { forYouLeftOut } from "../../src/lib/jobs/for-you/left-out";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";
import {
    COMMERCIAL_FINANCE_TEXT,
    GENERIC_WORDS_CONSULTANT_TEXT,
    IT_SUPPORT_TEXT,
    PORTFOLIO_DELIVERY_TEXT,
    PRODUCT_TEXT,
    SECURITY_OPS_TEXT,
    SHORT_PRODUCT_LEAD_TEXT,
    SOCIAL_SERVICES_TEXT,
    SUPPLY_CHAIN_TEXT,
} from "../fixtures/job-descriptions/content-family-postings";

// Vivek's product résumé (13 years, senior technical product owner) and technical account manager résumé: the two the
// 2026-10-16 deck was read against. Both sit in Richmond Hill, Ontario.
const load = (file: string): ResumeData => {
    const base = resumeDataFromPlainText(readFileSync(path.join(process.cwd(), "tests/fixtures", file), "utf8"));
    return { ...base, profile: { ...base.profile, location: "Richmond Hill, Ontario, Canada" } };
};
const PM = load("vivek-pm-resume.txt");
const TAM = load("vivek-tam-resume.txt");

/** A fabricated IT support person: a résumé from a line of work that is none of Vivek's. */
const IT_SUPPORT_RESUME: ResumeData = {
    profile: { name: "Sam Rivera", profession: "IT Support Specialist", yearsOfExperience: 8, location: "Toronto, Ontario, Canada", email: "sam@example.com", phone: "", linkedin: "", website: "" },
    experience: [
        {
            id: "e1",
            company: "Harbour Health",
            role: "IT Support Specialist",
            dates: "2018 - Present",
            description:
                "Resolved tickets in the ticketing system and troubleshot technical issues for 400 staff by phone, chat and remote session.\nReset passwords and managed user accounts in Active Directory.\nInstalled and configured software and escalated hard problems to second-line support.\nFollowed ITIL practice and documented fixes in the knowledge base on the service desk.",
        },
        {
            id: "e2",
            company: "Maple Retail",
            role: "Help Desk Analyst",
            dates: "2015 - 2018",
            description: "Answered help desk calls, troubleshot hardware and Windows issues, and kept customers updated until each ticket was resolved.",
        },
    ],
    competencies: [{ category: "Skills", skills: ["Active Directory", "Microsoft 365", "ITIL", "Troubleshooting"] }],
    education: [{ id: "ed1", degree: "Diploma, Computer Systems Technology", institution: "State College", year: "2015" }],
    generatedSummary: "IT support specialist with eight years on service desks.",
};

/** A résumé whose experience says too little to read (a title and a line). */
const THIN_RESUME: ResumeData = {
    ...IT_SUPPORT_RESUME,
    experience: [{ id: "e1", company: "Somewhere", role: "Product Manager", dates: "2020 - Present", description: "Worked as a product manager." }],
};

function job(title: string, description: string, overrides: Partial<PublicJob> = {}): PublicJob {
    const base = {
        id: `job-${title}`,
        title,
        company: "Acme",
        location: "Toronto, Ontario, Canada",
        location_city: "Toronto",
        location_state: "Ontario",
        location_country: "Canada",
        work_type: "remote",
        employment_type: "full_time",
        experience_level: "senior",
        description,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: new Date().toISOString(),
        vacancy_status: "open",
        ghost_badge: "clear",
        min_years_experience: 3,
        must_have_skills: [],
        skills_section_found: false,
        ...overrides,
    } as unknown as PublicJob;
    return { ...base, jd_terms: jdTermsFromDescription(description, base) } as PublicJob;
}

/** The same posting scored as it was before the content read: its `family` taken off. */
const withoutRead = (j: PublicJob): PublicJob => ({ ...j, jd_terms: { ...j.jd_terms!, family: undefined } }) as PublicJob;

const score = (resume: ResumeData, j: PublicJob): MatchScore => {
    const s = scoreJobAgainstResume(resume, j, resolveCandidateSignals(resume, null));
    assert.ok(s, `${j.title} should score`);
    return s;
};

describe("the family lexicon", () => {
    it("holds 35 lines of work with 40 weighted terms each", () => {
        const families = Object.keys(FAMILY_LEXICON);
        assert.equal(families.length, 35);
        for (const id of families) {
            const terms = FAMILY_LEXICON[id]!;
            assert.equal(terms.length, 40, id);
            assert.ok(terms.every(([term, weight]) => term.length > 1 && weight > 0), id);
        }
        // The first 15 are the app's own role families (RoleFamilyId), so a résumé's headline can be compared with them.
        for (const id of ["product", "engineering", "data", "customer_success", "clinical", "teaching", "operations"]) assert.ok(id in FAMILY_LEXICON, id);
    });

    it("names no host, request or sample text, only the terms", () => {
        const text = JSON.stringify(FAMILY_LEXICON);
        assert.ok(!/169\.58|https?:|meili/i.test(text));
    });

    it("has a label for every line of work", () => {
        for (const id of Object.keys(FAMILY_LEXICON)) assert.notEqual(contentFamilyLabel(id), id.replace(/_/g, " ") + "!", id);
        assert.equal(contentFamilyLabel("supply_chain_logistics"), "supply chain and logistics");
    });
});

describe("what a posting's text reads as", () => {
    const cases: Array<[string, string, string, string]> = [
        ["supply chain", SUPPLY_CHAIN_TEXT, "supply_chain_logistics", "supply chain"],
        ["case management", SOCIAL_SERVICES_TEXT, "social_services", "case management"],
        ["ticketing", IT_SUPPORT_TEXT, "it_support", "ticketing system"],
        ["security operations", SECURITY_OPS_TEXT, "security_ops", "siem"],
        ["product management", PRODUCT_TEXT, "product", "product roadmap"],
    ];
    for (const [name, text, family, term] of cases) {
        it(`reads ${name} work as ${family}, clearly, with the terms that say so`, () => {
            const read = postingContentFamily(text, null);
            assert.ok(read, name);
            assert.equal(read.id, family);
            assert.ok(read.margin >= CONTENT_FAMILY_MIN_MARGIN);
            assert.ok(read.terms.length >= 3 && read.terms.length <= 4, read.terms.join(", "));
            assert.ok(read.terms.includes(term), `${term} in ${read.terms.join(", ")}`);
        });
    }

    it("says nothing for a text that mixes two lines of work evenly, or has too few of a family's terms", () => {
        const mixed = `${PRODUCT_TEXT}\n\n${SUPPLY_CHAIN_TEXT}`;
        const read = postingContentFamily(mixed, null);
        // Two families at about the same strength: the margin is under the bar, so neither is called.
        assert.equal(read, null);
        const generic =
            "About the role\n\nWe are looking for a team player to join our fast-moving company. You will work with a variety of stakeholders, communicate clearly and grow with us as we deliver great things for our customers every day. We value curiosity, kindness and a willingness to learn.";
        assert.equal(postingContentFamily(generic, "Coordinator"), null);
        assert.ok(CONTENT_FAMILY_MIN_TERMS >= 6);
    });

    it("says nothing for a short text or an empty one", () => {
        assert.equal(postingContentFamily("Supply chain, purchase orders, procurement, inventory management.", null), null);
        assert.equal(postingContentFamily("", "Coordinator"), null);
        assert.equal(postingContentFamily(null, null), null);
    });

    it("never reads the posting's own title as its content", () => {
        // A text that is mostly its title repeated: with the title taken out there is nothing left to read.
        const title = "Supply Chain Procurement Coordinator";
        const echo = Array.from({ length: 12 }, () => `We are hiring a ${title}. The ${title} will join our team.`).join(" ");
        assert.equal(postingContentFamily(echo, title), null);
    });

    it("rides on a posting's terms only when it is clear, in a few dozen bytes", () => {
        const clear = jdTermsFromDescription(SUPPLY_CHAIN_TEXT, { title: "Product Engineering Coordinator", company: "Acme", location: "Toronto" });
        assert.equal(clear?.family?.id, "supply_chain_logistics");
        assert.ok(JSON.stringify(clear!.family).length < 200, JSON.stringify(clear!.family));
        const unclear = jdTermsFromDescription(
            "About the role\n\nWe are looking for a team player to join our fast-moving company.\n\nWhat you'll do\n\nWork with a variety of stakeholders and grow with the company as it delivers for customers.",
            { title: "Coordinator" },
        );
        assert.ok(unclear);
        assert.equal(unclear.family, undefined);
    });
});

describe("the lines of work a résumé's experience shows", () => {
    it("is the leader and any family within a fifth of its score", () => {
        assert.deepEqual([...resumeContentFamilies(PM)!].sort(), ["data", "product"]);
        // A technical account manager sits between two lines of work (product 7.9, customer success 7.1): both are theirs.
        const tam = resumeContentFamilies(TAM)!;
        for (const id of ["product", "customer_success"]) assert.ok(tam.has(id), id);
    });

    it("is read from what the person did, in any line of work", () => {
        const it = resumeContentFamilies(IT_SUPPORT_RESUME);
        assert.ok(it?.has("it_support"), [...(it ?? [])].join(", "));
        assert.ok(!it?.has("product"));
    });

    it("is nothing for experience too thin to read", () => {
        assert.equal(resumeContentFamilies(THIN_RESUME), null);
    });
});

describe("the content lane: a posting that reads as another line of work", () => {
    // [title, text, the title's lane without the read]. The titles are the ones of the 2026-10-16 deck.
    const WRONG: Array<[string, string, string]> = [
        ["Product Engineering Coordinator", SUPPLY_CHAIN_TEXT, "supply chain and logistics"],
        ["Learning & Development Specialist", SOCIAL_SERVICES_TEXT, "social services and community support"],
        ["(Remote) Customer Support Analyst", IT_SUPPORT_TEXT, "IT support"],
        ["SecOps Engineer", SECURITY_OPS_TEXT, "security operations"],
    ];

    for (const [name, resume] of [
        ["the product résumé", PM],
        ["the technical account manager résumé", TAM],
    ] as const) {
        for (const [title, text, label] of WRONG) {
            it(`${name}: "${title}" is a different kind of role, capped under Good and left out`, () => {
                const j = job(title, text);
                assert.ok(j.jd_terms?.family, "the posting reads as one line of work");
                const before = score(resume, withoutRead(j));
                const after = score(resume, j);
                // Without the read the title lane decides, as it always did: no family named by the title.
                assert.equal(before.role, "unverified");
                assert.equal(after.role, "off-target");
                assert.equal(roleAffinity(resume, j), "off-target");
                assert.ok(after.total < MATCH_BAND_GOOD_MIN, `${after.total}`);
                assert.ok(after.total <= before.total);
                assert.equal(after.contentLed, undefined);
                assert.equal(forYouLeftOut(after, { keepUnplaced: true }), "other-role");
                assert.equal(after.contentFamily?.id, j.jd_terms!.family!.id);
                // The reason says what the text is and the words that say so, not a share of the posting's words the résumé has.
                const why = explainMatch(after);
                assert.match(why, new RegExp(`^The posting reads as ${label} work \\(`));
                assert.ok(after.contentFamily!.terms.every((term) => why.includes(term)), why);
                assert.match(why, /a different kind of role from your .+ work, so it's a Stretch at most\./);
                assert.ok(!/of what the posting asks for/.test(why), why);
            });
        }
    }

    it("a résumé of that line of work is not told it is another: an IT support person keeps the support analyst", () => {
        const j = job("Application Support Analyst", IT_SUPPORT_TEXT);
        assert.equal(j.jd_terms?.family?.id, "it_support");
        const after = score(IT_SUPPORT_RESUME, j);
        assert.notEqual(after.role, "off-target");
        assert.equal(after.contentFamily, undefined);
        assert.equal(after.total, score(IT_SUPPORT_RESUME, withoutRead(j)).total);
        // And what is none of theirs is still another line of work: a security operations posting for the same person.
        const secops = score(IT_SUPPORT_RESUME, job("SecOps Engineer", SECURITY_OPS_TEXT));
        assert.equal(secops.role, "off-target");
        assert.equal(secops.contentFamily?.id, "security_ops");
    });

    it("is silent for a résumé with nothing to compare to", () => {
        const j = job("Product Engineering Coordinator", SUPPLY_CHAIN_TEXT);
        assert.equal(score(THIN_RESUME, j).total, score(THIN_RESUME, withoutRead(j)).total);
        assert.notEqual(score(THIN_RESUME, j).role, "off-target");
    });

    it("is silent for a posting that does not read clearly: the title decides, as before", () => {
        const text = "About the role\n\nWe are looking for a team player to join our fast-moving company. You will work with a variety of stakeholders, communicate clearly and grow with us as we deliver great things for our customers every day. We value curiosity and kindness.\n\nWhat you'll do\n\nSupport the team, plan the work and keep stakeholders informed.";
        const j = job("Delivery Coordinator", text);
        assert.equal(j.jd_terms?.family, undefined);
        assert.equal(score(PM, j).role, score(PM, withoutRead(j)).role);
    });
});

describe("the content lane never lifts and never overrules the résumé's own kind of role", () => {
    it("a posting that reads as the résumé's own line of work is scored by its title exactly as before", () => {
        for (const [resume, title] of [
            [PM, "Senior Product Manager, AI"],
            [PM, "Platform Lead"],
            [TAM, "Senior Product Manager, AI"],
            [TAM, "Platform Lead"],
        ] as const) {
            const j = job(title, PRODUCT_TEXT);
            assert.equal(j.jd_terms?.family?.id, "product");
            const after = score(resume, j);
            const before = score(resume, withoutRead(j));
            assert.equal(after.total, before.total, title);
            assert.equal(after.role, before.role, title);
            assert.equal(after.contentFamily, undefined);
            assert.notEqual(after.role, "off-target", title);
        }
    });

    it("a title that is the résumé's own role is not overruled by the lexicon", () => {
        // A Product Manager at a security vendor is a product role, whatever words its text is full of.
        const j = job("Product Manager", SECURITY_OPS_TEXT);
        assert.equal(j.jd_terms?.family?.id, "security_ops");
        const after = score(PM, j);
        assert.equal(after.role, "own");
        assert.equal(after.total, score(PM, withoutRead(j)).total);
        assert.equal(after.contentFamily, undefined);
    });

    it("a title of another line of work whose text is the résumé's is scored as before (no lift)", () => {
        const j = job("Software Engineer, API Platform", PRODUCT_TEXT);
        const after = score(PM, j);
        const before = score(PM, withoutRead(j));
        assert.equal(after.role, before.role);
        assert.equal(after.total, before.total);
        assert.equal(after.contentLed, before.contentLed);
    });

    it("a line of work the headline names is the résumé's own, whatever its bullets read as", () => {
        // A Data Analyst headline over bullets that read as operations: a data posting is not another line of work.
        const resume: ResumeData = { ...PM, profile: { ...PM.profile, profession: "Data Analyst" } };
        const j = job("Reporting Coordinator", PRODUCT_TEXT.replace(/product/gi, "data"));
        const before = score(resume, withoutRead(j));
        assert.equal(score(resume, j).role, before.role);
    });
});

describe("a title tied to none of the résumé's roles is Good only when its posting shows the résumé's work", () => {
    // The "Commercial Finance Business Partner" of the 2026-10-16 deck: no line of work reads clearly in its text, and
    // the words it shares with a product résumé ("performance", "planning", "analysis") made it Good.
    const FINANCE_TITLE = "Commercial Finance Business Partner";

    for (const [name, resume] of [
        ["the product résumé", PM],
        ["the technical account manager résumé", TAM],
    ] as const) {
        it(`${name}: a posting that shares only general words is a Stretch and left out, and says what it lacked`, () => {
            const j = job(FINANCE_TITLE, COMMERCIAL_FINANCE_TEXT);
            assert.equal(j.jd_terms?.family, undefined, "no line of work reads clearly in it");
            const s = score(resume, j);
            assert.equal(s.role, "unverified");
            assert.equal(s.unproven, true);
            assert.equal(s.gaps, undefined, "held by its title and text alone, not by a requirement");
            assert.ok((s.components[0]!.jd?.fit ?? 0) >= JD_GOOD_MIN_FIT, "its words overlap the résumé enough to have read Good");
            assert.ok(s.total < MATCH_BAND_GOOD_MIN, `${s.total}`);
            assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "stretch");
            const why = explainMatch(s);
            assert.match(why, /^We couldn't tie this title to your .+ role, and its text doesn't show your kind of work: it only shares words like .+ with your résumé, so it's a Stretch at most\./);
            assert.ok(!/of what the posting asks for/.test(why), why);
            assert.match(s.components[0]!.detail, /the posting doesn't read as your line of work/);
        });
    }

    it("the same text under the résumé's own or a neighbouring title is scored as before: only an unplaced title needs the proof", () => {
        const own = score(PM, job("Senior Product Manager", COMMERCIAL_FINANCE_TEXT));
        assert.equal(own.role, "own");
        assert.equal(own.unproven, undefined);
        assert.ok(own.total >= MATCH_BAND_GOOD_MIN, `${own.total}`);
        const next = score(TAM, job("Senior Product Manager", COMMERCIAL_FINANCE_TEXT));
        assert.equal(next.role, "adjacent");
        assert.equal(next.unproven, undefined);
        assert.ok(next.total >= MATCH_BAND_GOOD_MIN, `${next.total}`);
    });

    it("an unplaced title whose text reads as the résumé's line of work keeps its fit", () => {
        for (const resume of [PM, TAM]) {
            const j = job("Platform Lead", PRODUCT_TEXT);
            assert.equal(j.jd_terms?.family?.id, "product");
            const s = score(resume, j);
            assert.equal(s.role, "unverified");
            assert.equal(s.unproven, undefined);
            assert.ok(s.total >= MATCH_BAND_GOOD_MIN, `${s.total}`);
        }
    });

    it("an unplaced title whose posting asks for what the résumé shows keeps its fit, however short its text", () => {
        for (const resume of [PM, TAM]) {
            const j = job("Digital Experience Lead, Member Platform", SHORT_PRODUCT_LEAD_TEXT);
            assert.equal(j.jd_terms?.family, undefined, "too short for the lexicon to call");
            const s = score(resume, j);
            assert.equal(s.role, "unverified");
            assert.equal(s.unproven, undefined);
            assert.ok(s.total >= MATCH_BAND_GOOD_MIN, `${s.total}`);
        }
    });

    it("only words that name work prove it: a phrase, or a word the lexicon holds for some line of work", () => {
        for (const word of ["software", "enterprise", "solutions", "management", "technical", "technology"]) assert.equal(isWorkWord(word), false, word);
        for (const word of ["roadmap", "backlog", "sql", "observability", "payroll", "clients"]) assert.equal(isWorkWord(word), true, word);
        const terms = workTerms(["software", "release coordination", "roadmap", "solutions"]);
        assert.deepEqual(terms, ["release coordination", "roadmap"]);
        assert.equal(workWeight(terms), 3, "a phrase weighs twice a word, as in coverage");
    });

    it("an unplaced title whose posting shares only the words every posting or industry uses is a Stretch, however many it shares", () => {
        for (const resume of [PM, TAM]) {
            const j = job("Implementation and Training Consultant", GENERIC_WORDS_CONSULTANT_TEXT);
            assert.equal(j.jd_terms?.family, undefined, "no line of work reads clearly in it");
            const s = score(resume, j);
            const jd = s.components[0]!.jd!;
            assert.equal(s.role, "unverified");
            assert.ok(jd.fit >= CONTENT_LED_MIN_FIT && (jd.evidence ?? 0) >= CONTENT_LED_MIN_EVIDENCE, "a count of every shared word would have proved it");
            assert.ok((jd.workEvidence ?? 0) < CONTENT_LED_MIN_EVIDENCE, `${jd.workEvidence}`);
            assert.equal(s.unproven, true);
            assert.ok(s.total < MATCH_BAND_GOOD_MIN, `${s.total}`);
            assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "stretch");
            // The why names only the words its proof counted, never the general ones.
            const shared = explainMatch(s).match(/it only shares words like (.+) with your résumé/)?.[1] ?? "";
            for (const generic of ["software", "enterprise", "solutions", "technical", "technology"]) assert.ok(!shared.includes(generic), shared);
        }
    });

    it("a neighbouring role whose posting names the résumé's work keeps its fit at the lowest weight measured", () => {
        for (const [resume, weight] of [
            [PM, 9],
            [TAM, 10],
        ] as const) {
            const s = score(resume, job("Portfolio Lead, Product Delivery", PORTFOLIO_DELIVERY_TEXT));
            assert.equal(s.role, "unverified");
            assert.equal(s.components[0]!.jd?.workEvidence, weight);
            assert.equal(s.unproven, undefined);
            assert.ok(s.total >= MATCH_BAND_GOOD_MIN, `${s.total}`);
        }
    });

    it("a résumé too thin to read has nothing to prove a posting against: its unplaced titles keep the old cap", () => {
        const s = score(THIN_RESUME, job(FINANCE_TITLE, COMMERCIAL_FINANCE_TEXT));
        assert.equal(s.unproven, undefined);
        assert.ok(!explainMatch(s).includes("doesn't show your kind of work"));
    });
});

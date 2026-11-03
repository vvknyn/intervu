/**
 * Bilingual titles and generic title modifiers (velai.app /jobs, Best fit).
 *
 * Before, on the owner's senior PM/TAM résumé:
 * - Flinks "Product Quality Owner - Payments / Responsable de la qualité produit"
 *   was Stretch, "7 of 26 terms this role names", missing chips included
 *   Responsable, de, la, qualit, produit.
 * - Janssen "Experienced Analyst Technical Product Manager" was Good (77), role
 *   own via Product Manager, and the row said "Title overlap · Technical Account
 *   Manager" on the words technical and manager. A title made only of those
 *   modifiers read as a fit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deckOverlapTitle } from "../../src/lib/jobs/for-you/deck-detail";
import { inferReasons } from "../../src/lib/jobs/for-you/infer-reasons";
import { rowReasonLine } from "../../src/lib/jobs/for-you/row-reason";
import { sortByFit } from "../../src/lib/jobs/for-you/band-order";
import { fitTerms } from "../../src/lib/match/fit-terms";
import { matchBand, matchBandLabel, relevanceTerms, scoreJobAgainstResume, termAsWritten } from "../../src/lib/match/score";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import {
    bilingualTitleHalves,
    isTruncatedStem,
    titleInResumeLanguage,
    titlesShareSignal,
} from "../../src/lib/match/title-signal";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

const STOP_CHIPS = new Set(["de", "la", "le", "les", "des", "du", "et", "of", "qualit"]);

const pm = resumeDataFromPlainText(readFileSync("tests/fixtures/vivek-pm-resume.txt", "utf8"));
const nurse = resumeDataFromPlainText(readFileSync("tests/fixtures/health-rn-resume.txt", "utf8"));

/** TAM listed first (the overlap that used to win), Product Manager held as well. */
const pmTam: ResumeData = {
    profile: {
        name: "A",
        profession: "Product Manager",
        yearsOfExperience: 13,
        location: "Richmond Hill, Ontario, Canada",
        email: "",
        phone: "",
        linkedin: "",
        website: "",
    },
    experience: [
        {
            id: "tam",
            company: "TELUS Health",
            role: "Technical Account Manager",
            dates: "September 2021 — Present",
            description: "Technical account manager for an enterprise SaaS portfolio. Roadmap, requirements, and releases.",
        },
        {
            id: "pm",
            company: "Earlier",
            role: "Product Manager",
            dates: "2013 — 2021",
            description: "Owned the product roadmap, backlog, and requirements.",
        },
    ],
    competencies: [{ category: "Product", skills: ["Roadmap", "Requirements", "SQL", "API"] }],
    education: [],
    generatedSummary: "Product Manager and Technical Account Manager with 13 years in enterprise SaaS.",
};

function job(partial: Partial<PublicJob> & Pick<PublicJob, "id" | "title">): PublicJob {
    return {
        company: "Acme",
        location: "Toronto, Ontario, Canada",
        location_country: "Canada",
        work_type: "hybrid",
        description: null,
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...partial,
    } as PublicJob;
}

const FLINKS_TAGS = [
    "payments", "eft", "interac", "open finance", "fintech", "banking", "automation",
    "quality assurance", "regression testing", "product management", "release management",
    "incident management", "settlement", "money movement", "quality gate",
];

const flinks = job({
    id: "flinks",
    title: "Product Quality Owner - Payments / Responsable de la qualité produit",
    company: "Flinks",
    tags: FLINKS_TAGS,
    work_type: "remote",
    location: "Remote, Canada",
});

const janssen = job({
    id: "janssen",
    title: "Experienced Analyst Technical Product Manager",
    company: "7710-Janssen-Ortho Inc. (formerly Ortho-McNe Legal Entity",
    tags: ["sap s/4hana", "logistics", "deployment", "it", "business process", "supply chain", "product management"],
    experience_level: "mid",
    work_type: "unknown",
    location: "Toronto, Ontario, Canada",
});

function chips(resume: ResumeData, role: PublicJob): string[] {
    return relevanceTerms(resume, role).missing.map((term) => termAsWritten(term, role));
}

function relevanceLine(resume: ResumeData, role: PublicJob): string {
    return scoreJobAgainstResume(resume, role)?.components.find((c) => c.key === "relevance")?.detail ?? "";
}

describe("bilingual titles", () => {
    it("splits EN / FR, FR / EN, and the dash variant, and keeps a single-language dash", () => {
        assert.deepEqual(bilingualTitleHalves(flinks.title), {
            english: "Product Quality Owner - Payments",
            french: "Responsable de la qualité produit",
        });
        assert.equal(
            titleInResumeLanguage("Responsable de la qualité produit / Product Quality Owner", ["english"]),
            "Product Quality Owner",
        );
        assert.equal(
            titleInResumeLanguage("Product Quality Owner - Responsable de la qualité produit", ["english"]),
            "Product Quality Owner",
        );
        assert.equal(
            titleInResumeLanguage("Développeur de données senior, niveau 2/Staff Data Developer", ["english"]),
            "Staff Data Developer",
        );
        assert.equal(
            titleInResumeLanguage("Product Quality Owner - Responsable de la qualité produit", ["french"]),
            "Responsable de la qualité produit",
        );
        assert.equal(bilingualTitleHalves("Product Quality Owner - Payments"), null);
        assert.equal(titleInResumeLanguage("Senior Product Manager - Payments", ["english"]), "Senior Product Manager - Payments");
    });

    it("does not count the French half, stopwords, or the cut stem qualit against an English résumé", () => {
        const missing = chips(pm, flinks);
        const terms = fitTerms(pm, flinks)!;
        const shown = [...terms.matched, ...terms.missing].map((chip) => chip.toLowerCase());
        for (const chip of shown) assert.ok(!STOP_CHIPS.has(chip), chip);
        assert.ok(!shown.some((chip) => chip === "responsable" || chip === "produit" || chip === "qualit" || chip === "qualité"));
        assert.equal(missing.length + terms.matched.length, 21);
        assert.match(relevanceLine(pm, flinks), /of 21 terms this role names/);
        assert.equal(matchBandLabel(matchBand(scoreJobAgainstResume(pm, flinks)!.total)), "Stretch");
    });

    it("drops stopwords and truncated stems from a French title that is not split", () => {
        const role = job({ id: "fr", title: "Responsable de la qualité produit" });
        const missing = chips(pm, role);
        assert.deepEqual(missing.map((chip) => chip.toLowerCase()).filter((chip) => STOP_CHIPS.has(chip)), []);
        assert.ok(!missing.includes("qualit"));
        assert.equal(isTruncatedStem("qualit", role.title), true);
        assert.equal(isTruncatedStem("qualité", role.title), false);
        const ofRole = job({ id: "of", title: "Head of Quality" });
        assert.ok(!chips(pm, ofRole).some((chip) => chip.toLowerCase() === "of"));
    });
});

describe("generic modifiers do not earn a title overlap or a Strong band", () => {
    it("does not call the Janssen title a Technical Account Manager overlap, and does not label it Strong", () => {
        const withTam: ResumeData = {
            ...pm,
            experience: [
                {
                    id: "tam",
                    company: "TELUS Health",
                    role: "Technical Account Manager",
                    dates: "September 2021 — Present",
                    description: pm.experience[0]?.description ?? "",
                },
                ...pm.experience,
            ],
        };
        for (const resume of [pm, withTam, pmTam]) {
            const score = scoreJobAgainstResume(resume, janssen);
            assert.ok(score);
            assert.notEqual(matchBand(score.total), "strong", resume.profile.profession);
            const overlap = deckOverlapTitle(janssen, resume);
            assert.ok(overlap);
            assert.match(overlap, /product manager/i);
            assert.doesNotMatch(overlap, /technical account manager/i);
            const row = rowReasonLine(janssen, score, resume) ?? "";
            assert.doesNotMatch(row, /technical account manager/i);
            const reasons = inferReasons(janssen, score, resume);
            assert.ok(!reasons.bullets.some((bullet) => /technical account manager|\(technical(, manager)?\)/i.test(bullet)));
            assert.ok(!reasons.chips.some((chip) => /technical account manager/i.test(chip)));
        }
        assert.equal(matchBandLabel(matchBand(scoreJobAgainstResume(pm, janssen)!.total)), "Good");
        assert.match(relevanceLine(pm, janssen), /of 15 terms this role names/);
    });

    it("a title that shares only generic modifiers is not Strong and is not a title overlap", () => {
        const generic = job({
            id: "generic",
            title: "Experienced Technical Specialist",
            experience_level: "senior",
            tags: ["management", "analyst"],
        });
        assert.equal(titlesShareSignal(generic.title, "Technical Account Manager"), false);
        assert.equal(deckOverlapTitle(generic, pmTam), null);
        const score = scoreJobAgainstResume(pmTam, generic);
        assert.ok(!score || matchBand(score.total) !== "strong");
        if (score) assert.notEqual(matchBand(score.total), "good");
        const row = rowReasonLine(generic, score, pmTam);
        assert.ok(!row || !/title overlap/i.test(row));
    });

    it("still overlaps a real role head, for a PM and for a nurse", () => {
        const product = job({ id: "spm", title: "Senior Product Manager", tags: ["roadmap", "backlog", "requirements"] });
        assert.match(deckOverlapTitle(product, pm) ?? "", /product manager/i);
        const productScore = scoreJobAgainstResume(pm, product)!;
        assert.notEqual(matchBand(productScore.total), "stretch");

        const icu = job({ id: "icu", title: "Registered Nurse - ICU", experience_level: "mid", tags: ["ICU", "patient care"] });
        assert.match(deckOverlapTitle(icu, nurse) ?? "", /nurse/i);
        assert.equal(matchBand(scoreJobAgainstResume(nurse, icu)!.total), "strong");

        const bilingualNurse = job({
            id: "rn-fr",
            title: "Infirmière autorisée / Registered Nurse - ICU",
            experience_level: "mid",
        });
        const missing = chips(nurse, bilingualNurse);
        assert.ok(!missing.some((chip) => /infirmière|autorise|autorisée/i.test(chip)), missing.join(", "));
        assert.equal(matchBand(scoreJobAgainstResume(nurse, bilingualNurse)!.total), "strong");
    });
});

describe("best-fit sanity sample", () => {
    const sample: PublicJob[] = [
        flinks,
        janssen,
        job({ id: "spm", title: "Senior Product Manager", tags: ["roadmap", "backlog", "requirements", "sql"] }),
        job({ id: "tpm", title: "Technical Product Manager", tags: ["roadmap", "api", "requirements"] }),
        job({ id: "po", title: "Product Owner", tags: ["backlog", "roadmap"] }),
        job({ id: "csm", title: "Customer Success Manager", tags: ["renewal", "qbr"] }),
        job({ id: "tam", title: "Technical Account Manager" }),
        job({ id: "generic", title: "Experienced Technical Specialist", tags: ["management", "analyst"] }),
        job({ id: "swe", title: "Senior Software Engineer", tags: ["java", "kubernetes"] }),
        job({ id: "rn", title: "Registered Nurse - ICU", experience_level: "mid", tags: ["ICU", "patient care"] }),
        job({ id: "rn-fr", title: "Infirmière autorisée / Registered Nurse", experience_level: "mid" }),
        job({ id: "lpn", title: "Licensed Practical Nurse", experience_level: "mid" }),
        job({ id: "np", title: "Nurse Practitioner - Emergency", experience_level: "senior" }),
        job({ id: "teacher", title: "High School Teacher", tags: ["curriculum", "classroom"] }),
        job({ id: "elec", title: "Electrician", tags: ["wiring"] }),
        job({ id: "acct", title: "Staff Accountant", tags: ["ledger", "gaap"] }),
        job({ id: "chef", title: "Sous Chef", tags: ["kitchen"] }),
        job({ id: "data", title: "Data Analyst", tags: ["sql", "dashboard"] }),
        job({ id: "design", title: "Product Designer", tags: ["figma", "prototype"] }),
        job({ id: "qa", title: "Quality Assurance Analyst", tags: ["regression testing"] }),
        job({ id: "impl", title: "Implementation Manager", tags: ["onboarding"] }),
        job({ id: "mgr", title: "Experienced Manager" }),
        job({ id: "wh", title: "Warehouse Associate", tags: ["forklift"] }),
        job({ id: "pharm", title: "Clinical Pharmacist", experience_level: "senior" }),
    ];

    function top(resume: ResumeData): Array<{ title: string; band: string; relevance: string; row: string }> {
        const scored = sample.map((role) => ({ role, score: scoreJobAgainstResume(resume, role) }));
        const ordered = sortByFit(scored, (item) => ({ job: item.role, score: item.score }), { nowMs: Date.parse("2026-11-02T12:00:00Z") });
        return ordered.slice(0, 20).map(({ role, score }) => ({
            title: role.title,
            band: score ? matchBandLabel(matchBand(score.total)) : "unscored",
            relevance: score?.components.find((c) => c.key === "relevance")?.detail.split(" · ")[0] ?? "",
            row: rowReasonLine(role, score, resume) ?? "",
        }));
    }

    it("prints the top best-fit rows and keeps Strong for real role matches", () => {
        const pmTop = top(pm);
        const nurseTop = top(nurse);
        console.log("\nPM best fit\n" + pmTop.map((row) => `${row.band}\t${row.relevance}\t${row.row}\t${row.title}`).join("\n"));
        console.log("\nNurse best fit\n" + nurseTop.map((row) => `${row.band}\t${row.relevance}\t${row.row}\t${row.title}`).join("\n"));

        const strongSharesRole = (resume: ResumeData, rows: typeof pmTop) => {
            for (const row of rows) {
                if (row.band !== "Strong") continue;
                const role = sample.find((item) => item.title === row.title)!;
                const titles = [resume.profile?.profession, ...(resume.experience ?? []).map((entry) => entry.role)];
                assert.ok(titles.some((title) => title && titlesShareSignal(role.title, title)), row.title);
            }
        };
        strongSharesRole(pm, pmTop);
        strongSharesRole(nurse, nurseTop);
        assert.ok(pmTop.some((row) => row.band === "Strong" && /product manager/i.test(row.title)));
        assert.ok(nurseTop.some((row) => row.band === "Strong" && /nurse/i.test(row.title)));
        const bandOf = (resume: ResumeData, title: string) => {
            const role = sample.find((item) => item.title === title)!;
            const score = scoreJobAgainstResume(resume, role);
            return score ? matchBandLabel(matchBand(score.total)) : "unscored";
        };
        assert.notEqual(bandOf(pm, janssen.title), "Strong");
        assert.notEqual(bandOf(pm, flinks.title), "Strong");
        for (const title of ["Experienced Technical Specialist", "Experienced Manager"]) {
            const band = bandOf(pm, title);
            assert.ok(band === "Stretch" || band === "unscored", `${title} ${band}`);
        }
        assert.notEqual(bandOf(nurse, janssen.title), "Strong");
    });
});

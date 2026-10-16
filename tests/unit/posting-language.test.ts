/**
 * The language a posting is written in, and the languages a person reads postings in (match/posting-language.ts):
 * a role written in a language the person has not chosen is left out of every recommending list with that reason,
 * and the same control that removes a language adds it. Vivek, 2026-10-16: "I dont want french jobs...how does a
 * user make sure that they either get or not get other language jobs".
 *
 * The postings are CONSTRUCTED (tests/fixtures/job-descriptions/other-language-postings.ts); the English side is
 * checked on every real-shaped English fixture and résumé in the repo, because the harm to avoid is an English role
 * read as another language and left out.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { deckLeftOut, nearMissSummary, orderForYouJobsByBand, orderNearMisses, summarizeDeckLeftOut } from "../../src/lib/jobs/for-you/band-order";
import { forYouLeftOut } from "../../src/lib/jobs/for-you/left-out";
import { formatLeftOutLine, leftOutParts } from "../../src/lib/jobs/for-you/left-out-copy";
import { pickToday, todayLanguagesLeftOut } from "../../src/lib/jobs/for-you/today";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguagesControl } from "../../src/components/jobs/LanguagesControl";
import { buildDailyPicksEmail } from "../../src/lib/email/templates/daily-picks";
import type { AgentPreferences } from "../../src/lib/agent/preferences";
import { explainMatch } from "../../src/lib/match/explain";
import { jdAsksFromDescription } from "../../src/lib/match/jd-asks";
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import { languageLabel, normalizeLanguages, resumeLanguages, textLanguages, WRITTEN_LANGUAGES } from "../../src/lib/match/posting-language";
import { requirementGaps } from "../../src/lib/match/requirement-gaps";
import { matchBand, scoreJobAgainstResume, type MatchScore } from "../../src/lib/match/score";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";
import { PRODUCT_TEXT, SUPPLY_CHAIN_TEXT } from "../fixtures/job-descriptions/content-family-postings";
import * as postings from "../fixtures/job-descriptions/postings";
import * as tailor from "../fixtures/job-descriptions/tailor-postings";
import {
    BILINGUAL_TEXT,
    ENGLISH_WITH_FRENCH_LINE_TEXT,
    FRENCH_ACCOUNT_TEXT,
    FRENCH_TEXT,
    GERMAN_TEXT,
    SPANISH_TEXT,
    TEXT_BY_LANGUAGE,
} from "../fixtures/job-descriptions/other-language-postings";

const FIXTURES = path.join(process.cwd(), "tests/fixtures");
const load = (file: string): ResumeData => {
    const base = resumeDataFromPlainText(readFileSync(path.join(FIXTURES, file), "utf8"));
    return { ...base, profile: { ...base.profile, location: "Richmond Hill, Ontario, Canada" } };
};
const PM = load("vivek-pm-resume.txt");

/** A product manager's résumé written in French, in Montréal: constructed. */
const FRENCH_RESUME: ResumeData = {
    profile: { name: "Camille Tremblay", profession: "Gestionnaire de produit", yearsOfExperience: 9, location: "Montréal, Québec, Canada", email: "camille@example.com", phone: "", linkedin: "", website: "" },
    experience: [
        {
            id: "e1",
            company: "Logiciels Fleuve",
            role: "Gestionnaire de produit principal",
            dates: "2019 - Présent",
            description:
                "Responsable de la feuille de route du produit pour une plateforme utilisée par plus de 800 clients au Québec.\nJ'ai travaillé avec les équipes de développement et de design pour livrer les fonctionnalités les plus demandées par nos clients.\nJ'ai animé des ateliers avec les utilisateurs et mesuré les résultats de chaque version avec des outils d'analyse.\nJ'ai rédigé les exigences et priorisé le carnet de produit avec les ventes et la direction.",
        },
        {
            id: "e2",
            company: "Atelier Nord",
            role: "Analyste d'affaires",
            dates: "2015 - 2019",
            description: "Analyse des besoins des clients, rédaction des spécifications et suivi des projets avec les équipes techniques de l'entreprise.",
        },
    ],
    competencies: [{ category: "Compétences", skills: ["Feuille de route", "Méthodes agiles", "Analyse de données", "Jira"] }],
    education: [{ id: "ed1", degree: "Baccalauréat en administration des affaires", institution: "Université de Montréal", year: "2015" }],
    generatedSummary: "Gestionnaire de produit avec neuf ans d'expérience dans des entreprises de logiciels, passionnée par les besoins des utilisateurs et par la livraison de résultats mesurables.",
};

const prefs = (languages?: string[]): AgentPreferences => ({ configured: true, search: languages ? { languages } : {}, answers: { custom: {} } });

function job(title: string, description: string, overrides: Partial<PublicJob> = {}): PublicJob {
    const base = {
        id: `job-${title}-${description.length}`,
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

const scoreWith = (resume: ResumeData, j: PublicJob, saved: AgentPreferences | null = null): MatchScore => {
    const s = scoreJobAgainstResume(resume, j, resolveCandidateSignals(resume, saved));
    assert.ok(s, `${j.title} should score`);
    return s;
};

describe("the language a text is written in", () => {
    for (const [language, text] of Object.entries(TEXT_BY_LANGUAGE)) {
        it(`reads a posting in ${languageLabel(language)} as ${language}, and only that`, () => {
            assert.deepEqual(textLanguages(text), [language]);
        });
    }

    it("reads a posting printed in two languages as both, the more used first", () => {
        const read = textLanguages(BILINGUAL_TEXT);
        assert.ok(read && read.includes("english") && read.includes("french"), JSON.stringify(read));
        assert.equal(read.length, 2);
    });

    it("reads an English posting with one line of French (an employer's equity statement) as English", () => {
        assert.deepEqual(textLanguages(ENGLISH_WITH_FRENCH_LINE_TEXT), ["english"]);
    });

    it("says nothing for text too short to tell, or in none of the languages it knows", () => {
        assert.equal(textLanguages(null), null);
        assert.equal(textLanguages(""), null);
        assert.equal(textLanguages("Gestionnaire de produit"), null);
        assert.equal(textLanguages("Product Manager, Montreal"), null);
        assert.equal(textLanguages("12 345 67 890 !!! 2026 © 🙂"), null);
        // A list of tools has no language to read.
        assert.equal(textLanguages("Python SQL Tableau Jira Confluence Figma Segment Amplitude Snowflake dbt Airflow Looker Salesforce Zendesk Okta Postman Kubernetes Terraform Datadog Grafana"), null);
    });

    it("never reads an English posting, résumé or fixture as another language", () => {
        const english: string[] = [];
        const collect = (value: unknown): void => {
            if (typeof value === "string") english.push(value);
            else if (value && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(postings);
        collect(tailor);
        english.push(PRODUCT_TEXT, SUPPLY_CHAIN_TEXT);
        const checked = english.filter((text) => text.length > 300);
        assert.ok(checked.length >= 20, `${checked.length} English postings checked`);
        for (const text of checked) {
            const read = textLanguages(text);
            assert.ok(read == null || (read.length === 1 && read[0] === "english"), `${JSON.stringify(read)}: ${text.slice(0, 80)}`);
        }
    });

    it("reads the 20 invented corpus résumés and the repo's fixture résumés as English only", () => {
        const dir = path.join(FIXTURES, "resume-corpus");
        const pasted = readdirSync(dir).filter((f) => f.endsWith(".paste.txt"));
        assert.equal(pasted.length, 20);
        for (const file of pasted) {
            const resume = resumeDataFromPlainText(readFileSync(path.join(dir, file), "utf8"));
            assert.deepEqual(resumeLanguages(resume), ["english"], file);
            assert.deepEqual(resolveCandidateSignals(resume, null).languages, { value: ["english"], source: "resume" }, file);
        }
        for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith("resume.txt"))) {
            assert.deepEqual(resumeLanguages(resumeDataFromPlainText(readFileSync(path.join(FIXTURES, file), "utf8"))), ["english"], file);
        }
    });

    it("names and normalizes only languages it can tell apart", () => {
        assert.deepEqual(normalizeLanguages(["French", " english ", "french", "klingon", 7, null]), ["french", "english"]);
        assert.deepEqual(normalizeLanguages(["Cantonese"]), ["mandarin"], "written Chinese is shared");
        assert.deepEqual(normalizeLanguages(undefined), []);
        assert.equal(languageLabel("mandarin"), "Chinese");
        assert.equal(languageLabel("french"), "French");
        assert.equal(WRITTEN_LANGUAGES[0], "english");
    });
});

describe("the languages a person reads postings in", () => {
    it("is their résumé's language by default: English for an English résumé", () => {
        assert.deepEqual(resolveCandidateSignals(PM, null).languages, { value: ["english"], source: "resume" });
    });

    it("is French and English for a résumé written in French: English is added, and removed by the same control", () => {
        assert.deepEqual(resumeLanguages(FRENCH_RESUME), ["french"]);
        assert.deepEqual(resolveCandidateSignals(FRENCH_RESUME, null).languages, { value: ["french", "english"], source: "resume" });
    });

    it("adds a language the résumé's Languages section lists, unless it calls it basic", () => {
        const listed = (...lines: string[]): ResumeData => ({ ...PM, additionalSections: [{ heading: "Languages", lines, after: null }] });
        assert.deepEqual(resumeLanguages(listed("English (native)", "French (fluent)")), ["english", "french"]);
        assert.deepEqual(resumeLanguages(listed("English, Spanish — professional working")), ["english", "spanish"]);
        assert.deepEqual(resumeLanguages(listed("English (native)", "French (basic)")), ["english"]);
        assert.deepEqual(resumeLanguages(listed("French - conversational", "German (learning)")), ["english"]);
        assert.deepEqual(resumeLanguages({ ...PM, additionalSections: [{ heading: "Certifications", lines: ["French cooking diploma"], after: null }] }), ["english"]);
    });

    it("is what they chose, ahead of the résumé: lowercased, once each, unknown names dropped", () => {
        assert.deepEqual(resolveCandidateSignals(PM, prefs(["French", "english", "French"])).languages, { value: ["french", "english"], source: "explicit" });
        assert.deepEqual(resolveCandidateSignals(PM, prefs(["klingon"])).languages, { value: ["english"], source: "resume" });
        assert.deepEqual(resolveCandidateSignals(PM, prefs([])).languages, { value: ["english"], source: "resume" }, "an empty choice is the résumé's language");
        assert.deepEqual(resolveCandidateSignals(FRENCH_RESUME, prefs(["french"])).languages, { value: ["french"], source: "explicit" }, "a French-only choice drops English");
    });

    it("is unknown for a résumé that says too little to read: no posting is judged by it", () => {
        const thin: ResumeData = { ...PM, generatedSummary: "", experience: [{ id: "e1", company: "X", role: "Product Manager", dates: "2020", description: "Worked as a product manager." }], projects: [], education: [] };
        assert.deepEqual(resolveCandidateSignals(thin, null).languages, { value: null, source: "unknown" });
        const s = scoreWith(thin, job("Gestionnaire de produit", FRENCH_TEXT));
        assert.equal(s.language, undefined);
    });
});

describe("a posting written in a language the person does not read", () => {
    const FR = job("Gestionnaire de produit senior", FRENCH_TEXT);
    const EN = job("Senior Product Manager", PRODUCT_TEXT);

    it("carries the language its text is in on its terms, and nothing for English it cannot tell apart", () => {
        assert.deepEqual(FR.jd_terms?.lang, ["french"]);
        assert.deepEqual(EN.jd_terms?.lang, ["english"]);
        assert.deepEqual(job("x", BILINGUAL_TEXT).jd_terms?.lang?.slice().sort(), ["english", "french"]);
        assert.equal(jdTermsFromDescription("Short ad.", { title: "x", must_have_skills: ["python"], skills_section_found: true } as never)?.lang, undefined);
    });

    it("is a Stretch for an English résumé, left out as 'language', whatever else it fits", () => {
        const s = scoreWith(PM, FR);
        assert.deepEqual(s.language, { posting: ["french"], yours: ["english"] });
        assert.equal(matchBand(s.total), "stretch");
        assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "language");
        assert.equal(deckLeftOut(FR, s, Date.now()), "language");
        assert.equal(deckLeftOut(FR, s, Date.now(), { strictPlace: true }), "language");
        // The same role in English is not touched.
        const en = scoreWith(PM, EN);
        assert.equal(en.language, undefined);
        assert.notEqual(forYouLeftOut(en, { keepUnplaced: true }), "language");
        assert.ok(en.total > s.total);
    });

    it("catches a French posting under an English title in the person's own line of work", () => {
        const own = job("Technical Account Manager", FRENCH_ACCOUNT_TEXT);
        assert.deepEqual(own.jd_terms?.lang, ["french"]);
        const s = scoreWith(PM, own);
        assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "language");
        assert.equal(forYouLeftOut(scoreWith(PM, own, prefs(["english", "french"])), { keepUnplaced: true }) === "language", false);
    });

    it("says why on the receipt, in the person's words", () => {
        const why = explainMatch(scoreWith(PM, FR));
        assert.match(why, /[Ii]t's written in French, and you read postings in English\./, why);
        const german = explainMatch(scoreWith(PM, job("Produktmanager", GERMAN_TEXT)));
        assert.match(german, /[Ii]t's written in German, and you read postings in English/, german);
    });

    it("stays when it is printed in the person's language too (a bilingual posting)", () => {
        const s = scoreWith(PM, job("Senior Product Manager", BILINGUAL_TEXT));
        assert.equal(s.language, undefined);
        assert.notEqual(forYouLeftOut(s, { keepUnplaced: true }), "language");
    });

    it("stays for a résumé written in French, and so do English roles (English is added)", () => {
        assert.equal(scoreWith(FRENCH_RESUME, FR).language, undefined);
        assert.equal(scoreWith(FRENCH_RESUME, EN).language, undefined);
        assert.equal(scoreWith(FRENCH_RESUME, job("Gestor de producto", SPANISH_TEXT)).language?.posting[0], "spanish");
    });

    it("comes back with the language added, and goes with it removed, by the one saved choice", () => {
        const chosen = prefs(["english", "french"]);
        assert.equal(scoreWith(PM, FR, chosen).language, undefined);
        assert.ok(scoreWith(PM, FR, chosen).total >= scoreWith(PM, FR).total);
        // Removing English from a French résumé's default leaves the English role out.
        const frenchOnly = scoreWith(FRENCH_RESUME, EN, prefs(["french"]));
        assert.deepEqual(frenchOnly.language, { posting: ["english"], yours: ["french"] });
        assert.equal(forYouLeftOut(frenchOnly, { keepUnplaced: true }), "language");
    });

    it("leaves a role whose place it cannot read for the place rule: a French posting in France is abroad first", () => {
        const paris = job("Gestionnaire de produit senior", FRENCH_TEXT, { location: "Paris, France", location_city: "Paris", location_state: null, location_country: "France", work_type: "onsite" });
        const s = scoreWith(PM, paris);
        assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "abroad");
    });

    it("is counted by the language it is written in, said with its count, and never revived as a near miss", () => {
        const roles = [
            job("Gestionnaire de produit senior", FRENCH_TEXT),
            job("Gestionnaire de produit", FRENCH_TEXT.replace("Montréal", "Laval"), { id: "fr-2" }),
            job("Produktmanager", GERMAN_TEXT, { id: "de-1" }),
            job("Senior Product Manager", PRODUCT_TEXT, { id: "en-1" }),
        ];
        const scores = new Map(roles.map((r) => [r.id, scoreWith(PM, r)] as const));
        const getScore = (r: PublicJob) => scores.get(r.id) ?? null;
        const summary = summarizeDeckLeftOut(roles, getScore, Date.now());
        assert.equal(summary.byReason.language, 3);
        assert.deepEqual(summary.languages, { french: 2, german: 1 });
        assert.deepEqual(leftOutParts(summary).filter((p) => /written in/.test(p)), ["2 written in French", "1 written in German"]);
        assert.match(formatLeftOutLine(summary) ?? "", /2 written in French · 1 written in German/);
        assert.deepEqual(orderForYouJobsByBand(roles, getScore, Date.now()).map((r) => r.id), ["en-1"]);
        // Nothing else fits: the closest roles are weaker fits, never a role in a language they do not read.
        assert.deepEqual(orderNearMisses(roles.slice(0, 3), getScore, Date.now()), []);
        assert.deepEqual(nearMissSummary(summary).languages, { french: 2, german: 1 });
        // Today and the daily picks hold the same line.
        assert.deepEqual(pickToday(roles.map((r) => ({ job: r, score: getScore(r)! })), { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id), ["en-1"]);
    });
});

describe("a language the posting asks for is a different thing from the language it is written in", () => {
    it("is no gap once the person has chosen it", () => {
        const asking = job("Customer Success Manager", `${PRODUCT_TEXT}\n\nFluent French is required for this role.`);
        assert.deepEqual(asking.jd_terms?.asks?.langs, ["french"]);
        assert.equal(requirementGaps(PM, asking).some((g) => g.kind === "language"), true);
        assert.equal(requirementGaps(PM, asking, ["english", "french"]).some((g) => g.kind === "language"), false);
        const s = scoreWith(PM, asking);
        assert.equal(s.language, undefined, "written in English");
        assert.equal(forYouLeftOut(s, { keepUnplaced: true }), "requirement");
        assert.equal(scoreWith(PM, asking, prefs(["english", "french"])).gaps?.some((g) => g.kind === "language") ?? false, false);
    });

    it("is read from the title too: 'French-speaking' and 'Bilingual (English/French)', not a bare 'Bilingual'", () => {
        const asks = (title: string) => jdAsksFromDescription(PRODUCT_TEXT, undefined, title)?.langs;
        assert.deepEqual(asks("French-speaking Account Manager"), ["french"]);
        assert.deepEqual(asks("Bilingual (English/French) Support Agent"), ["french"]);
        assert.equal(asks("Bilingual Software Product Owner"), undefined);
        assert.equal(asks("Spanish Teacher"), undefined, "a subject is not an ask");
        assert.equal(jdAsksFromDescription(PRODUCT_TEXT, undefined, "Senior Product Manager")?.langs, undefined);
    });
});

describe("where the choice shows", () => {
    const FR = job("Gestionnaire de produit senior", FRENCH_TEXT);
    const DE = job("Produktmanager", GERMAN_TEXT, { id: "de-1" });
    const EN = job("Senior Product Manager", PRODUCT_TEXT, { id: "en-1" });

    it("counts Today's roles left out for their language, each opening once, beside the control that brings them back", () => {
        const roles = [FR, { ...FR, id: "fr-copy" }, DE, EN].map((j) => ({ job: j, score: scoreWith(PM, j) }));
        assert.deepEqual(todayLanguagesLeftOut(roles, Date.now()), { french: 1, german: 1 });
        assert.deepEqual(todayLanguagesLeftOut(roles, Date.now()), todayLanguagesLeftOut([...roles].reverse(), Date.now()));
        // Chosen: nothing is left out for it any more.
        const withFrench = [FR, DE, EN].map((j) => ({ job: j, score: scoreWith(PM, j, prefs(["english", "french"])) }));
        assert.deepEqual(todayLanguagesLeftOut(withFrench, Date.now()), { german: 1 });
    });

    const markup = (props: Partial<Parameters<typeof LanguagesControl>[0]> = {}) =>
        renderToStaticMarkup(
            React.createElement(LanguagesControl, { languages: ["english"], resumeDefault: ["english"], onChange: () => {}, testId: "t", ...props }),
        );

    it("lists the languages read, one tap to add another, and a button for each language that kept roles out", () => {
        const html = markup({ leftOut: { french: 8, german: 2 } });
        assert.match(html, /data-testid="t-chip-english"/);
        assert.match(html, /data-testid="t-add"/);
        assert.match(html, /Include French \(8\)/);
        assert.match(html, /Include German \(2\)/);
        assert.ok(html.indexOf("Include French") < html.indexOf("Include German"), "largest first");
        // The last language cannot be removed: nothing listed would mean nothing is judged.
        assert.doesNotMatch(html, /Stop showing postings written in English/);
    });

    it("lets any one of several be removed, and offers a language only when it is not listed", () => {
        const html = markup({ languages: ["english", "french"], resumeDefault: ["english"], leftOut: { french: 3, german: 1 } });
        assert.match(html, /Stop showing postings written in French/);
        assert.match(html, /Stop showing postings written in English/);
        assert.doesNotMatch(html, /Include French/, "already listed");
        assert.match(html, /Include German \(1\)/);
        assert.doesNotMatch(html, /<option value="french">/, "listed languages are not offered again");
        assert.match(html, /<option value="german">German<\/option>/);
    });

    it("tells the daily email which languages its picks are written in, and where to change them", () => {
        const model = {
            siteUrl: "https://velai.app",
            unsubscribeUrl: "https://velai.app/unsubscribe?token=t",
            picks: [{ title: "Senior Product Manager", employer: "Acme", location: "Toronto", salary: null, fit: "Strong", why: "Your role, at your level.", href: "https://velai.app/jobs/x" }],
        };
        const both = buildDailyPicksEmail({ ...model, languages: ["english", "french"] });
        for (const body of [both.html, both.text]) {
            assert.ok(body.includes("Roles written in English or French; others are left out."), body.slice(0, 400));
            assert.ok(body.includes("https://velai.app/settings?tab=prefs"), "change them in Settings");
        }
        assert.ok(buildDailyPicksEmail({ ...model, languages: ["english"] }).text.includes("Roles written in English; others are left out."));
        // The week's roles left out for language are counted in the email's own words, beside the way in.
        const counted = buildDailyPicksEmail({ ...model, languages: ["english"], languagesLeftOut: { german: 2, spanish: 5 } });
        for (const body of [counted.html, counted.text]) {
            assert.ok(body.includes("Roles written in English. Left out this week: 5 written in Spanish, 2 written in German."), body.slice(0, 500));
            assert.ok(body.includes("https://velai.app/settings?tab=prefs"));
        }
        assert.ok(buildDailyPicksEmail({ ...model, languages: ["english", "french", "german"] }).text.includes("English, French or German"));
        const none = buildDailyPicksEmail(model);
        assert.ok(!none.text.includes("others are left out") && !none.html.includes("Change the languages"), "no language is judged: nothing is claimed");
    });
});

/**
 * The language a piece of text is written in, read from the text alone: the posting's description, or the
 * résumé. The index carries no language field on a posting (`PublicJob`, JOBS_INDEX_SETTINGS), so a role
 * written in French reached an English-reading person's lists with nothing to say it would not read as theirs
 * (Vivek, 2026-10-16: "I dont want french jobs"). jd-asks.ts reads only an English posting that ASKS for a
 * language ("fluent in French"); this reads the language the posting itself is in.
 *
 * Two plain signals, no model: the SCRIPT of the letters (Hangul is Korean, kana is Japanese, Cyrillic is Russian
 * or Ukrainian…) and, for the Latin script, how many of the words are ones only one language uses (articles,
 * pronouns, prepositions and the handful of nouns every job ad repeats: "experiencia", "Aufgaben", "équipe"). A
 * word two listed languages share ("de", "en", "la") counts for neither, so a Spanish ad is not half French.
 *
 * It names a language only when it is clear, and a text can be written in several (a bilingual posting is in
 * both): too short, or none of the languages known here, reads as `null` — unknown, never a reason to leave a role
 * out. Names are the lowercase English names jd-asks.ts uses for the languages a posting asks for.
 *
 * Pure and isomorphic, like the rest of match/.
 */
import type { ResumeData } from "@/types/resume";

/** Languages besides English a posting may ask for, or be written in. The one list jd-asks.ts and the languages control share. */
export const SPOKEN_LANGUAGES = [
    "french", "spanish", "german", "italian", "portuguese", "dutch", "swedish", "polish", "russian", "ukrainian", "turkish", "greek", "hebrew", "arabic",
    "hindi", "punjabi", "urdu", "tamil", "bengali", "gujarati", "mandarin", "cantonese", "japanese", "korean", "vietnamese", "tagalog", "thai", "indonesian",
] as const;

/**
 * The languages a text can be told to be written in, English first: the ones with a script of their own or word
 * list below. The languages control offers these, and a saved choice outside them is dropped. "mandarin" is
 * written Chinese (the Han script is shared with Cantonese), so it reads as "Chinese".
 */
export const WRITTEN_LANGUAGES = [
    "english", "french", "spanish", "german", "italian", "portuguese", "dutch", "swedish", "polish", "turkish", "indonesian", "russian", "ukrainian", "greek",
    "hebrew", "arabic", "hindi", "punjabi", "gujarati", "bengali", "tamil", "mandarin", "japanese", "korean", "thai",
] as const;

/** "french" → "French"; "mandarin" → "Chinese". */
export function languageLabel(language: string): string {
    return language === "mandarin" ? "Chinese" : language.charAt(0).toUpperCase() + language.slice(1);
}

/** The languages in `list` this module can name, lowercase and once each, in the order given; `[]` for anything else. */
export function normalizeLanguages(list: readonly unknown[] | null | undefined): string[] {
    const out: string[] = [];
    for (const item of list ?? []) {
        const raw = typeof item === "string" ? item.trim().toLowerCase() : "";
        const name = raw === "cantonese" ? "mandarin" : raw;
        if ((WRITTEN_LANGUAGES as readonly string[]).includes(name) && !out.includes(name)) out.push(name);
    }
    return out;
}

/** Words of one language and no other listed here (a word in two lists is dropped from both below). */
const WORDS: Record<string, string> = {
    english:
        "the and of to in for with you our is are will we on as be that this or your have from at by it not their who all can about which has was they more been would such into these also what when how its them if an any may must should than then there those within while both each through including across over between per",
    french:
        "le la les un une des du de au aux à et est sont pour dans avec sur vous nous tu on votre notre vos nos qui que ce cette ces par ou où être avoir sera serez chez entre afin ainsi aussi tout tous mais comme sans leur leurs son ses elle ils ne pas se si ont fait faire peut sous lors dont poste expérience équipe entreprise emploi compétences responsabilités exigences candidat candidature rejoindre",
    spanish:
        "el los las del os y con para por una unos como más pero sin sobre este esta estos estas ser será también nuestro nuestra nuestros nuestras tu tus su sus al lo no son entre que se si en la un muy ya hay están está puesto experiencia equipo empresa empleo requisitos funciones trabajo conocimientos candidato",
    german:
        "der die das den dem des und ist sind mit für von zu im in an am auf eine einen einer einem eines wir sie ihr ihre ihren unser unsere unseren bei als auch nicht nie oder werden wird will was um da es so ab sich nach aus über durch noch nur wenn zur zum vom beim dass haben hat bewerbung erfahrung aufgaben kenntnisse unternehmen mitarbeiter stelle anforderungen fähigkeiten",
    italian:
        "il lo gli del della dei delle degli di in da la le un e si ha ma se ci ne vi su tu che per con una uno sono nel nella nei nelle alla alle agli al sul sulla dal dalla come anche più non tra fra suo sua suoi nostro nostra nostri nostre loro questo questa questi queste può essere sarà esperienza azienda lavoro requisiti competenze candidato candidati",
    portuguese:
        "os as do da dos das em no na nos nas um uma uns umas para com por que não também mais mas seu sua seus suas nosso nossa nossos nossas você vocês nós são será ao aos à às ou entre este esta sobre ser experiência empresa vaga trabalho requisitos equipe conhecimento candidato",
    dutch:
        "de het een en van voor met op te zijn is of over om dan dat die der wij je jij jouw ons onze ook bij naar uit door wordt worden als deze dit niet meer kan ervaring bedrijf functie werk vacature kennis",
    swedish:
        "och att det den som en ett är för med på av har vi du din dina våra vår kan till inte om sin erfarenhet företag tjänst arbete kompetens ansök",
    polish:
        "się nie że jest to oraz dla jako przez lub od po będzie nasz nasza naszej doświadczenie firma praca stanowisko wymagania obowiązki",
    turkish: "ve bir bu için ile olarak olan daha çok veya ya deneyim iş pozisyon şirket aranan görev",
    indonesian: "yang dan di untuk dengan dari pada dalam akan atau ini kami anda pengalaman perusahaan pekerjaan kualifikasi",
};

/** Each listed word → the one language that uses it. */
const WORD_LANGUAGE: ReadonlyMap<string, string> = (() => {
    const seen = new Map<string, string | null>();
    for (const [language, words] of Object.entries(WORDS)) {
        for (const word of words.split(" ")) seen.set(word, seen.has(word) ? null : language);
    }
    const out = new Map<string, string>();
    for (const [word, language] of seen) if (language) out.set(word, language);
    return out;
})();

/** Letters of a script that only one language of the list writes (Han is Chinese unless kana is beside it, Cyrillic Russian unless Ukrainian's letters are). */
const SCRIPTS: readonly { language: string; letters: RegExp }[] = [
    { language: "korean", letters: /\p{Script=Hangul}/gu },
    { language: "thai", letters: /\p{Script=Thai}/gu },
    { language: "greek", letters: /\p{Script=Greek}/gu },
    { language: "hebrew", letters: /\p{Script=Hebrew}/gu },
    { language: "arabic", letters: /\p{Script=Arabic}/gu },
    { language: "hindi", letters: /\p{Script=Devanagari}/gu },
    { language: "punjabi", letters: /\p{Script=Gurmukhi}/gu },
    { language: "gujarati", letters: /\p{Script=Gujarati}/gu },
    { language: "bengali", letters: /\p{Script=Bengali}/gu },
    { language: "tamil", letters: /\p{Script=Tamil}/gu },
];
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HAN = /\p{Script=Han}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const UKRAINIAN_LETTERS = /[іїєґІЇЄҐ]/;
const LETTERS = /\p{L}/gu;
const LATIN_WORDS = /\p{Script=Latin}{2,}/gu;

/** Letters of a script, as a share of all letters, that make the language "written here". */
const SCRIPT_MIN_SHARE = 0.2;
const SCRIPT_MIN_LETTERS = 20;
/** Fewest Latin words to judge by: shorter reads as unknown. */
const MIN_WORDS = 20;
/** A language is written here when its own words are this share of the Latin words and at least `MIN_HITS`, and no fewer than this share of the leader's. */
const MIN_SHARE = 0.05;
const MIN_HITS = 5;
const MIN_OF_LEADER = 0.4;

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

/** A text with its markup and entities gone. */
function plain(text: string): string {
    return text.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&");
}

/**
 * The languages `text` is written in, the most used first; `null` when it is too short or none of the languages
 * known here clearly leads. A bilingual text names both.
 */
export function textLanguages(text: string | null | undefined): string[] | null {
    const body = plain(text ?? "");
    if (!body.trim()) return null;
    const found: { language: string; weight: number }[] = [];

    const letters = count(body, LETTERS);
    if (letters === 0) return null;
    const nonLatin = (re: RegExp) => count(body, re);
    for (const { language, letters: re } of SCRIPTS) {
        const n = nonLatin(re);
        if (n >= SCRIPT_MIN_LETTERS && n / letters >= SCRIPT_MIN_SHARE) found.push({ language, weight: n / letters });
    }
    const kana = nonLatin(KANA);
    const han = nonLatin(HAN);
    if (kana + han >= SCRIPT_MIN_LETTERS && (kana + han) / letters >= SCRIPT_MIN_SHARE) {
        found.push({ language: kana >= 5 ? "japanese" : "mandarin", weight: (kana + han) / letters });
    }
    const cyrillic = nonLatin(CYRILLIC);
    if (cyrillic >= SCRIPT_MIN_LETTERS && cyrillic / letters >= SCRIPT_MIN_SHARE) {
        found.push({ language: UKRAINIAN_LETTERS.test(body) && !/[ыэъё]/i.test(body) ? "ukrainian" : "russian", weight: cyrillic / letters });
    }

    const words = body.toLowerCase().match(LATIN_WORDS) ?? [];
    if (words.length >= MIN_WORDS) {
        const hits = new Map<string, number>();
        for (const word of words) {
            const language = WORD_LANGUAGE.get(word);
            if (language) hits.set(language, (hits.get(language) ?? 0) + 1);
        }
        const leader = Math.max(0, ...hits.values());
        for (const [language, n] of hits) {
            if (n >= MIN_HITS && n / words.length >= MIN_SHARE && n >= MIN_OF_LEADER * leader) found.push({ language, weight: n / words.length });
        }
    }
    return found.length > 0 ? found.sort((a, b) => b.weight - a.weight).map((f) => f.language) : null;
}

/** Wording of a level that is not reading ability: a language the résumé names only as "basic" is not one they read postings in. */
const NOT_READING = /\b(?:basic|beginner|elementary|limited|learning|novice|conversational|a1|a2|b1)\b/i;
const SPOKEN = new RegExp(String.raw`\b(${SPOKEN_LANGUAGES.join("|")})\b`, "gi");

/** The languages a résumé's own "Languages" section names (not "basic" or "learning"): English or French written beside a level. */
function listedLanguages(resume: ResumeData): string[] {
    const lines = [
        ...(resume.additionalSections ?? []).filter((s) => /language/i.test(s.heading ?? "")).flatMap((s) => s.lines ?? []),
        ...(resume.competencies ?? []).filter((g) => /language/i.test(g.category ?? "")).flatMap((g) => g.skills ?? []),
    ];
    const out: string[] = [];
    for (const line of lines) {
        for (const part of line.split(/[,;/•·|]+/)) {
            if (NOT_READING.test(part)) continue;
            for (const m of part.matchAll(SPOKEN)) out.push(m[1]!.toLowerCase());
        }
    }
    return normalizeLanguages(out);
}

/** What a résumé says, in the order it says it, for reading its language. */
function resumeText(resume: ResumeData): string {
    return [
        resume.generatedSummary ?? "",
        ...(resume.experience ?? []).flatMap((e) => [e.role ?? "", e.description ?? ""]),
        ...(resume.projects ?? []).flatMap((p) => [p.role ?? "", p.description ?? ""]),
        ...(resume.education ?? []).flatMap((e) => [e.degree ?? "", ...(e.coursework ?? [])]),
    ].join("\n");
}

const RESUME_LANGUAGES = new WeakMap<ResumeData, string[] | null>();

/** A résumé's lines are short and plain ("Managed calendars for 3 executives"), too few function words to name a language; this many Latin words with none of another language's read as English. */
const RESUME_MIN_WORDS = 15;

/**
 * The languages a résumé reads in: what it is written in, and any language its Languages section lists besides
 * (not as "basic"). A bilingual résumé names both. A Latin-script résumé that no listed language claims is
 * English, the site's own: a language this module cannot name never leaves a role out (`textLanguages` reads
 * its postings as unknown too). `null` when the résumé says too little to tell.
 */
export function resumeLanguages(resume: ResumeData | null | undefined): string[] | null {
    if (!resume) return null;
    const cached = RESUME_LANGUAGES.get(resume);
    if (cached !== undefined) return cached;
    const text = resumeText(resume);
    const written = textLanguages(text) ?? (count(text, LATIN_WORDS) >= RESUME_MIN_WORDS ? ["english"] : null);
    const languages = written ? normalizeLanguages([...written, ...listedLanguages(resume)]) : null;
    RESUME_LANGUAGES.set(resume, languages);
    return languages;
}

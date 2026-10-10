/**
 * The pure half of résumé tailoring: the truthfulness gate every accepted
 * draft passes (`groundDraft`) and the job → tailor-input adapter. Split out
 * of tailor-with-engine.ts so a caller that only runs the heuristic tailor
 * (the Velai Chrome extension) can use them without bundling the on-device
 * model ladder. tailor-with-engine.ts re-exports both, so its callers are
 * unchanged.
 */
import { locationText } from "@/lib/jobs/presentation";
import { finishDraft, introducesNewNumbers, SUMMARY_SKILLS_WORDS, type TailorChange, type TailorDraft, type TailorJobInput } from "./tailor-resume";

const GROUNDED_WORD_MIN_LENGTH = 4;
const GROUNDED_WORD_RE = new RegExp(`[a-z]{${GROUNDED_WORD_MIN_LENGTH},}`, "g");

/** Words that join a sentence and claim nothing (a model's "across",
 *  "including"): a rewrite may use them whether or not the résumé does. No
 *  noun, verb or skill is here. */
const CONNECTIVE_WORDS = [
    "about", "above", "across", "after", "against", "along", "also", "among", "around", "before", "behind", "below",
    "beneath", "beside", "besides", "between", "beyond", "both", "despite", "down", "during", "each", "either",
    "even", "from", "having", "here", "including", "inside", "into", "itself", "just",
    "near", "neither", "other", "others", "over", "same", "since", "some",
    "such", "than", "that", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this",
    "those", "though", "through", "throughout", "thus", "toward", "towards", "under", "unlike", "until", "upon",
    "using", "very", "were", "what", "when", "where", "whereas", "whether", "which", "while", "whom", "whose",
    "with", "within", "without", "would", "your", "been", "being", "have", "will", "well",
];

/** The word without its ending ("assessments", "assessed" → "assess"), so a
 *  rewrite may use another form of a word the résumé uses ("documenting" for
 *  "documentation"), never a different word. */
function stem(word: string): string {
    const cut = word.replace(/(ations|ation|ments|ment|ings|ing|ions|ion|ers|er|ed|es|ly|s)$/, "");
    return cut.length >= 4 ? cut : word;
}

/** Raw (unfiltered) word membership for `resumeText` — deliberately not the
 *  stopword-filtered keyword set used for scoring: ordinary words like "team"
 *  or "company" are fine for a rewrite to reuse, only words absent from the
 *  résumé altogether are invented claims. Holds each word and its stem. */
function resumeWordSet(resumeText: string, extra: readonly string[]): Set<string> {
    const words = [
        ...(resumeText.toLowerCase().match(GROUNDED_WORD_RE) ?? []),
        ...CONNECTIVE_WORDS,
        ...SUMMARY_SKILLS_WORDS,
        ...extra.map((w) => w.toLowerCase()),
    ];
    return new Set([...words, ...words.map((w) => `~${stem(w)}`)]);
}

/** True when `text` contains a word of `GROUNDED_WORD_MIN_LENGTH`+ letters
 *  that is no form of any word in the résumé's own text. */
function introducesUngroundedWord(vocabulary: Set<string>, text: string): boolean {
    const words = text.toLowerCase().match(GROUNDED_WORD_RE) ?? [];
    return words.some((w) => !vocabulary.has(w) && !vocabulary.has(`~${stem(w)}`));
}

function isGrounded(vocabulary: Set<string>, before: string, after: string): boolean {
    return !introducesNewNumbers(before, after) && !introducesUngroundedWord(vocabulary, after);
}

function changeIsGrounded(vocabulary: Set<string>, change: TailorChange, skillsText: string): boolean {
    switch (change.kind) {
        case "summary":
            // The summary may name a listed skill, digits and all ("Primavera P6").
            return isGrounded(vocabulary, `${change.before} ${skillsText}`, change.after);
        case "line":
            return isGrounded(vocabulary, change.before, change.after);
        case "skills":
            return isGrounded(vocabulary, change.before.join(" "), change.after.join(" "));
        case "order":
            return true;
    }
}

/**
 * The tailor's truthfulness gate (front-door C1) — applied to every accepted
 * draft, heuristic or model, at draft-acceptance time. Drops any edit that
 * (a) introduces a number absent from its original (for the summary, its
 * original and the résumé's skills), or (b) introduces a word
 * of `GROUNDED_WORD_MIN_LENGTH`+ letters that is neither a form of a word in the résumé's own
 * text, nor a connective word (`CONNECTIVE_WORDS`) or the summary's "Core
 * skills include" (`SUMMARY_SKILLS_WORDS`), nor one of the posting's
 * words that means the same as a résumé word (`draft.equivalents`, from
 * tailor-wording.ts) — an unconditional class guard. A dropped edit is left
 * out of the draft and its line keeps the résumé's wording in `tailored`, so
 * the returned résumé never carries an ungrounded claim.
 */
export function groundDraft(resumeText: string, draft: TailorDraft): TailorDraft {
    const vocabulary = resumeWordSet(resumeText, draft.equivalents);
    const skillsText = draft.base.competencies.flatMap((c) => c.skills).join(" ");
    return finishDraft({ ...draft, changes: draft.changes.filter((c) => changeIsGrounded(vocabulary, c, skillsText)) });
}

/** PublicJob → TailorJobInput adapter for UI callers. */
export function jobToTailorInput(job: {
    title: string;
    company?: string | null;
    tags?: string[] | null;
    description?: string | null;
    occupation?: string | null;
    location?: string | null;
    location_city?: string | null;
    location_state?: string | null;
    location_country?: string | string[] | null;
    work_type?: string | null;
}): TailorJobInput {
    const place = locationText(job as Parameters<typeof locationText>[0]);
    const location =
        place && place !== "Location not listed" ? place : (job.location?.trim() || null);
    return {
        title: job.title,
        company: job.company,
        tags: job.tags,
        description: job.description,
        occupation: job.occupation,
        location,
    };
}

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
export function wordStem(word: string): string {
    // "assess", "process": a double s is the word's own, not a plural.
    const cut = word.replace(/(ations|ation|ments|ment|ings|ing|ions|ion|ers|er|ed|es|ly|(?<!s)s)$/, "");
    if (cut.length < 4) return word;
    // "administered" and "administer", "delivering" and "deliver": the "er" of
    // a verb that ends in it comes off under an inflection too.
    const verb = /(ed|ings?|es|(?<!s)s)$/.test(word) ? cut.replace(/er$/, "") : cut;
    return verb.length >= 4 ? verb : cut;
}

/** Raw (unfiltered) word membership for `resumeText` — deliberately not the
 *  stopword-filtered keyword set used for scoring: ordinary words like "team"
 *  or "company" are fine for a rewrite to reuse, only words absent from the
 *  résumé altogether are invented claims. Holds each word and its stem. */
export function resumeWordSet(resumeText: string, extra: readonly string[]): Set<string> {
    const words = [
        ...(resumeText.toLowerCase().match(GROUNDED_WORD_RE) ?? []),
        ...CONNECTIVE_WORDS,
        ...SUMMARY_SKILLS_WORDS,
        ...extra.map((w) => w.toLowerCase()),
    ];
    return new Set([...words, ...words.map((w) => `~${wordStem(w)}`)]);
}

/** The words of `GROUNDED_WORD_MIN_LENGTH`+ letters in `text` that are no form
 *  of any word in the résumé's own text (nor connectives or `extra`). */
export function ungroundedWords(vocabulary: Set<string>, text: string): string[] {
    const words = text.toLowerCase().match(GROUNDED_WORD_RE) ?? [];
    return [...new Set(words.filter((w) => !vocabulary.has(w) && !vocabulary.has(`~${wordStem(w)}`)))];
}

function introducesUngroundedWord(vocabulary: Set<string>, text: string): boolean {
    return ungroundedWords(vocabulary, text).length > 0;
}

function isGrounded(vocabulary: Set<string>, before: string, after: string): boolean {
    return !introducesNewNumbers(before, after) && !introducesUngroundedWord(vocabulary, after);
}

/** The words a change asks the person to confirm (`TailorChange.confirm`): it
 *  starts off and names them, so they pass the gate for that change only. */
function withConfirmed(vocabulary: Set<string>, confirm: string[] | undefined): Set<string> {
    if (!confirm?.length) return vocabulary;
    const words = confirm.flatMap((w) => w.toLowerCase().match(GROUNDED_WORD_RE) ?? []);
    return new Set([...vocabulary, ...words]);
}

function changeIsGrounded(vocabulary: Set<string>, change: TailorChange, skillsText: string, resumeText: string): boolean {
    switch (change.kind) {
        case "summary":
            // The summary may name a listed skill, digits and all ("Primavera P6"),
            // and sum up a line's figures ("a crew of 12").
            return isGrounded(withConfirmed(vocabulary, change.confirm), `${change.before} ${skillsText} ${resumeText}`, change.after);
        case "line":
            return isGrounded(withConfirmed(vocabulary, change.confirm), change.before, change.after);
        case "skills":
            return isGrounded(vocabulary, change.before.join(" "), change.after.join(" "));
        case "order":
        case "leave-out":
            return true;
    }
}

/**
 * The tailor's truthfulness gate (front-door C1) — applied to every accepted
 * draft, heuristic or model, at draft-acceptance time. Drops any edit that
 * (a) introduces a number absent from its original (for the summary, the
 * résumé's text and skills), or (b) introduces a word
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
    return finishDraft({ ...draft, changes: draft.changes.filter((c) => changeIsGrounded(vocabulary, c, skillsText, resumeText)) });
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

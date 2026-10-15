/**
 * Which questions on an application form Velai drafts an answer to, and which
 * it leaves to the person. Pure; the Chrome extension's card asks it for each
 * free-text question it finds, and the MCP draft_screening_answer tool asks
 * it for the question an assistant passes.
 *
 * A draft is only for a question an applicant answers in their own words from
 * their experience ("Why are you interested in this role?", "Describe your
 * experience with X"). Everything that is a fact about the person's situation,
 * a legal statement, a consent or a number they alone can set is theirs:
 * work authorisation, diversity and demographic questions, pay, start date,
 * relocation and schedule, background checks, agreements, where they heard
 * about the job, their history with the employer, and a cover letter or open
 * note (no question to answer). Each skipped kind has a short reason the card
 * shows ("Velai leaves this one to you: pay").
 *
 * Questions are read in English. A question that is not recognisably English
 * is left to the person rather than guessed at.
 */

export type QuestionVerdict = { draft: true } | { draft: false; reason: string };

/** The longest question text kept (sent to the model and shown in the card). */
export const QUESTION_MAX_CHARS = 300;

const SKIPS: readonly { reason: string; test: RegExp }[] = [
    {
        reason: "work authorization and eligibility",
        test: /\b(authori[sz]ed to work|work authori[sz]ation|legally (able|eligible|entitled|permitted|authori[sz]ed)|eligible to work|eligibility to work|employment eligibility|right to work|work permit|visa|sponsor\w*|citizen\w*|permanent resident|immigration|work status|age of majority|legal age|at least 1[68] years|over (the age of )?1[68])\b/i,
    },
    {
        reason: "personal and diversity questions",
        test: /\b(gender|sex|race|racial|ethnic\w*|veteran|military|disabilit\w*|pronouns?|sexual orientation|transgender|lgbtq?\w*|religio\w*|date of birth|birth ?date|age|marital|national origin|indigenous|first nations|self[- ]?identif\w*|hispanic|latino|latina|aboriginal)\b/i,
    },
    {
        reason: "pay",
        test: /\b(salary|salaries|compensation|expected pay|desired pay|pay (expectations?|range|rate|requirements?)|hourly rate|rate of pay|ctc|remuneration|wages?|expected (base|total|annual)|what are you (looking|hoping|expecting) to (make|earn))\b/i,
    },
    {
        reason: "start date and availability",
        test: /\b(notice period|when (can|could|are|would) you (start|begin|be available|join)|start date|available to start|earliest (start|date)|availability|how soon|current notice|date available)\b/i,
    },
    {
        reason: "location, travel and schedule",
        test: /\b(relocat\w*|commut\w*|(willing|able|open|ready|comfortable|prepared) (to )?(travel|work(ing)? (on[- ]?site|in[- ]?(the )?office|from (the )?office|hybrid|weekends|nights|evenings|shifts|overtime|holidays))|(on[- ]?site|in[- ]?(the )?office)\b.*\b(days?|week|required|expected)\b|\b(days?|week)\b.*\b(on[- ]?site|in[- ]?(the )?office)|work schedule|(rotating|night|weekend|evening) shifts?|overtime|reliable transportation|driver'?s licen[cs]e|hours (per|a) (week|day)|full[- ]time or part[- ]time|preferred (work )?location)\b/i,
    },
    {
        reason: "background checks and legal questions",
        test: /\b(criminal|convict\w*|felony|misdemeanou?r|background (check|screen\w*)|drug (test\w*|screen\w*)|security clearance|clearance|non[- ]?compete|non[- ]?solicit\w*|conflicts? of interest|bound by|under (any )?(agreement|contract|obligation)s?)\b/i,
    },
    {
        reason: "agreements and consent",
        test: /\b((i|we) (agree|acknowledge|consent|certify|confirm|understand|accept|authori[sz]e)|privacy (policy|notice|statement)|terms (and|&) conditions|terms of (use|service)|data (processing|protection|retention)|gdpr|ccpa|consent|truthful|accurate and complete|talent (pool|community|network)|future opportunities|text messages?|sms)\b/i,
    },
    {
        reason: "where you heard about the job",
        test: /\b(how did you (hear|find|learn)|where did you (hear|find|see|learn)|how you heard|who referred|referred (you|by)|referral|source of (your )?application)\b/i,
    },
    {
        reason: "your history with this employer",
        test: /\b((previously|ever|formerly) (been )?(employed|worked|applied|interviewed)|(currently|presently) (an )?employ\w*|current employee|former employee|related to (an? )?(employee|anyone)|relatives?|family members?|friends? (who )?works?)\b/i,
    },
    {
        reason: "a cover letter or open note, not a question",
        test: /\b(cover letter|additional (information|comments?|details|notes?)|anything else|other (comments?|information)|(^|\s)comments?$|(^|\s)notes?$|message to (the )?(hiring|recruit)\w*)/i,
    },
];

/** Words almost every English question has; a question with none of them, or mostly other scripts, isn't read. */
const ENGLISH_WORDS = new Set([
    "the", "a", "an", "of", "to", "you", "your", "why", "what", "how", "describe", "tell", "us", "about", "do", "does", "did", "have",
    "has", "are", "is", "in", "for", "with", "and", "or", "this", "that", "our", "we", "please", "share", "give", "explain", "which",
    "when", "where", "who", "would", "could", "can", "from", "on", "at", "as", "be", "it", "if", "any", "most", "time", "example",
]);

/** Pure: the question without the marks forms add ("*", "(required)", "Question 3:"), on one line, cut to `QUESTION_MAX_CHARS`. */
export function questionText(label: string): string {
    const text = label
        .replace(/\(\s*(required|optional)\s*\)/gi, " ")
        .replace(/[*✱•]+/g, " ")
        .replace(/^\s*(question\s*\d+|q\d+)\s*[:.)-]\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > QUESTION_MAX_CHARS ? `${text.slice(0, QUESTION_MAX_CHARS - 1).trimEnd()}…` : text;
}

function readsAsEnglish(text: string): boolean {
    const letters = text.match(/\p{L}/gu) ?? [];
    if (letters.length === 0) return false;
    const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
    if (latin / letters.length < 0.85) return false;
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    // A short label ("Interests") has too few words to tell; only longer questions need a common English word.
    return words.length < 4 || words.some((w) => ENGLISH_WORDS.has(w));
}

/** Pure: whether a single-line field's label is a prompt to answer ("Why do you want to work here?") rather than a plain field ("Current company"). */
export function looksLikeQuestion(label: string): boolean {
    const text = questionText(label);
    if (text.length < 15) return false;
    return /\?\s*$/.test(text) || /^(why|what|how|describe|tell|explain|share|give|list|which|please (describe|explain|share|tell|list|provide)|in (a few|your own) words)\b/i.test(text);
}

/** Pure: draft an answer to this question, or leave it to the person and say why. */
export function classifyQuestion(label: string): QuestionVerdict {
    const text = questionText(label);
    if (!text) return { draft: false, reason: "no question to answer" };
    if (!readsAsEnglish(text)) return { draft: false, reason: "a question Velai can't read yet (English only)" };
    for (const { reason, test } of SKIPS) if (test.test(text)) return { draft: false, reason };
    return { draft: true };
}

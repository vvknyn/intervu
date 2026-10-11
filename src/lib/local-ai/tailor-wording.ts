/**
 * Rewording a résumé line in a posting's own words, by rules that cannot add
 * a claim: each one swaps a word for one that means the same thing, so the
 * line says what it said before, the way this posting says it.
 *
 *  - Action verbs: a line that opens with "Charted" reads "Documented" when the
 *    posting asks to "document"; "Worked with" reads "Collaborated with" when it
 *    says "collaborate". Only verbs in the same small group of near-synonyms
 *    (`VERB_GROUPS`), only where the verb opens the line or follows "and", and
 *    a role uses each of the posting's verbs to open at most one more line, so
 *    its lines don't all start the same way.
 *  - Spelling: "counselling" reads "counseling", "healthcare" "health care",
 *    "Javascript" "JavaScript", when that is how the posting writes the same
 *    word (`spellingKey`).
 *  - Acronyms the posting spells out: "customer satisfaction" reads
 *    "customer satisfaction (CSAT)" once on the page when the posting writes
 *    "customer satisfaction (CSAT)", and an acronym alone gets its long form.
 *
 * Pure: no window, no model. The same word groups tell the grounding gate
 * (tailor-ground.ts) which of the posting's words mean the same as a word the
 * résumé already uses (`equivalentWords`), so an on-device model's rewrite
 * may use them too.
 */

type VerbForms = { base: string; past: string; ing: string; s: string; target: boolean };

/** `forms` is "base past ing s" ("-" for a form that is another word, like "fit");
 *  a member with `target` false is read but never written in (postings use
 *  "chart", "log", "track" and "head" mostly as nouns; "optimized" claims more
 *  than "improved"). */
function verb(forms: string, target = true): VerbForms {
    const [base, past, ing, s] = forms.split(" ");
    return { base, past, ing, s, target };
}

/** Near-synonyms as the verb that opens a résumé line: swapping one for another
 *  changes the wording, never what the person did. Kept small on purpose; a
 *  verb that also names a different act elsewhere ("drove" a truck, "delivered"
 *  a parcel, "deployed" overseas) is not in any group. */
const VERB_GROUPS: VerbForms[][] = [
    [verb("lead led leading leads"), verb("head headed heading heads", false), verb("spearhead spearheaded spearheading spearheads", false)],
    [verb("manage managed managing manages"), verb("oversee oversaw overseeing oversees"), verb("supervise supervised supervising supervises")],
    [verb("build built building builds"), verb("develop developed developing develops"), verb("create created creating creates")],
    [verb("collaborate collaborated collaborating collaborates"), verb("partner partnered partnering partners")],
    [verb("coordinate coordinated coordinating coordinates"), verb("organize organized organizing organizes"), verb("arrange arranged arranging arranges")],
    [verb("mentor mentored mentoring mentors"), verb("coach coached coaching coaches"), verb("precept precepted precepting precepts", false)],
    [verb("analyze analyzed analyzing analyzes"), verb("assess assessed assessing assesses"), verb("evaluate evaluated evaluating evaluates")],
    [verb("improve improved improving improves"), verb("enhance enhanced enhancing enhances"), verb("optimize optimized optimizing optimizes", false)],
    [verb("reduce reduced reducing reduces"), verb("cut cut cutting cuts"), verb("decrease decreased decreasing decreases"), verb("lower lowered lowering lowers", false)],
    [verb("increase increased increasing increases"), verb("grow grew growing grows"), verb("boost boosted boosting boosts", false)],
    [verb("resolve resolved resolving resolves"), verb("solve solved solving solves")],
    [verb("monitor monitored monitoring monitors"), verb("track tracked tracking tracks", false)],
    [verb("document documented documenting documents"), verb("chart charted charting charts", false), verb("log logged logging logs", false)],
    [verb("advise advised advising advises"), verb("counsel counselled counselling counsels")],
    [verb("recruit recruited recruiting recruits"), verb("hire hired hiring hires")],
    [verb("streamline streamlined streamlining streamlines"), verb("simplify simplified simplifying simplifies")],
    [verb("greet greeted greeting greets"), verb("welcome welcomed welcoming welcomes")],
    [verb("identify identified identifying identifies"), verb("uncover uncovered uncovering uncovers"), verb("spot spotted spotting spots", false)],
    [verb("prepare prepared preparing prepares"), verb("compile compiled compiling compiles", false), verb("cook cooked cooking cooks", false)],
    [verb("install installed installing installs"), verb("- fitted fitting -", false)],
];

/** "Worked with" reads as the collaborate group's verb ("Collaborated with"). */
const WORK_WITH_RE = /^(work|worked|working|works)(\s+closely)?\s+with\b/i;
const WORK_WITH_GROUP = 3;

/** A verb followed by one of these is a phrase ("Managed to", "Headed up",
 *  "Logged in", "Coordinated with") whose swap could break the sentence: left
 *  as written. The collaborate group takes "with" either way, and "in" or "on"
 *  before a name is where it was done ("charted in Epic"). */
const PARTICLE_AFTER_RE = /^\s+(?:(?:to|up|out|off|into|with|for|at|by|over|down|back|from|about|through)\b|(?:in|on)\b(?!\s+\p{Lu}))/u;

type Tense = "base" | "past" | "ing" | "s";

/** Words a pair can't join with: "set up" is not "setup", "on call" is not "oncall". */
const PAIR_FIRST_STOP = new Set(["any", "every", "some", "not", "for", "with", "may", "can", "all", "out", "and", "the", "our", "your", "their", "over", "under", "how", "what", "when", "where", "there", "here", "now", "more", "less", "along", "mean", "through", "off", "back", "down", "after", "before", "into", "onto", "upon"]);
const PAIR_SECOND_STOP = new Set(["out", "off", "down", "over", "back", "into", "through", "the", "and", "with", "for", "all", "self", "ever", "ward", "wards", "fore", "more", "less", "how", "where", "one", "thing", "body", "side", "way"]);

/** Two words a posting may write as one ("health care" / "healthcare", "full time" / "full-time"):
 *  both real words, long enough together that a join can't land on another word ("over all"). */
function joinsAsOneWord(a: string, b: string): boolean {
    return /^\p{L}{3,}$/u.test(a) && /^\p{L}{3,}$/u.test(b) && a.length + b.length >= 8;
}

const EXPLICIT_SPELLINGS: Record<string, string> = {
    programme: "program",
    programmes: "programs",
    licence: "license",
    licences: "licenses",
    defence: "defense",
    offence: "offense",
    judgement: "judgment",
    ageing: "aging",
    enrolment: "enrollment",
    fulfilment: "fulfillment",
    instalment: "installment",
    skilful: "skillful",
    grey: "gray",
    manoeuvre: "maneuver",
    mould: "mold",
    aluminium: "aluminum",
    jewellery: "jewelry",
    artefact: "artifact",
    sceptical: "skeptical",
};

/**
 * One key for every way the same word is written: case, hyphens and dots
 * ("e-commerce", "Node.js"), British and American spelling ("organisation",
 * "analyse", "colour", "centre", "modelling", "catalogue", "paediatric").
 * Two words share a key only when they are the same word, so a line takes the
 * posting's spelling only when the posting writes that same word.
 */
export function spellingKey(word: string): string {
    let w = word.toLowerCase().replace(/[’']/g, "").replace(/[-.\s]/g, "");
    w = EXPLICIT_SPELLINGS[w] ?? w;
    if (w.length >= 7) w = w.replace(/ae/g, "e").replace(/oe/g, "e");
    w = w.replace(/isation/g, "ization").replace(/is(e|ed|es|ing|er|ers)$/, "iz$1");
    w = w.replace(/ys(e|ed|es|ing)$/, "yz$1");
    if (w.length >= 6) w = w.replace(/our(s|ed|ing|er|ers|al|ally|ite|ites|able|ably)?$/, "or$1");
    w = w.replace(/([tb])re(s|d)?$/, "$1er$2");
    if (w.length >= 8) w = w.replace(/ll(ed|ing|er|ers|or|ors)$/, "l$1");
    w = w.replace(/ogue(s)?$/, "og$1");
    return w;
}

const WORD_RE = /\p{L}[\p{L}\p{N}]*(?:['’.\-+#][\p{L}\p{N}]+)*/gu;

/** "U.S." and "e.g." are abbreviations, not one word with a dot inside. */
function isDottedAbbreviation(token: string): boolean {
    return /^(\p{L}\.)+\p{L}$/u.test(token);
}

function hasCamelCase(word: string): boolean {
    return /\p{Ll}\p{Lu}/u.test(word);
}

function isAllCaps(word: string): boolean {
    return /\p{Lu}.*\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word);
}

/** The posting's spelling, in the line's own case: "Counselled" → "Counseled". */
function inLineCase(lineWord: string, postingWord: string): string {
    if (hasCamelCase(postingWord)) return postingWord;
    if (isAllCaps(lineWord) && lineWord.length >= 2) return postingWord.toUpperCase();
    if (/^\p{Lu}/u.test(lineWord)) return postingWord.charAt(0).toUpperCase() + postingWord.slice(1);
    if (isAllCaps(postingWord)) return postingWord;
    return postingWord.toLowerCase();
}

function capitalizeLike(model: string, word: string): string {
    return /^\p{Lu}/u.test(model) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export interface Acronym {
    short: string;
    long: string;
}

const MINOR_WORDS = new Set(["of", "and", "for", "the", "in", "to", "on", "&"]);

/** True when `letters` can be read off `words` in order, each word giving the
 *  start of itself ("customer satisfaction" → CSAT: c + sat), a minor word
 *  ("and", "of") giving nothing or its first letter. */
function spellsAcronym(letters: string, words: string[]): boolean {
    const memo = new Map<string, boolean>();
    const go = (li: number, wi: number): boolean => {
        if (li === letters.length) return wi === words.length;
        if (wi === words.length) return false;
        const key = `${li}:${wi}`;
        const seen = memo.get(key);
        if (seen !== undefined) return seen;
        const word = words[wi].toLowerCase();
        let ok = false;
        if (MINOR_WORDS.has(word) && wi > 0 && go(li, wi + 1)) ok = true;
        for (let n = 1; !ok && n <= word.length && li + n <= letters.length; n++) {
            if (word.slice(0, n) !== letters.slice(li, li + n)) break;
            if (go(li + n, wi + 1)) ok = true;
        }
        memo.set(key, ok);
        return ok;
    };
    return go(0, 0);
}

/** Acronyms the posting spells out itself: "customer satisfaction (CSAT)",
 *  "Electronic Health Record (EHR)", "Key Performance Indicators (KPIs)". */
export function postingAcronyms(text: string): Acronym[] {
    const found = new Map<string, Acronym>();
    const re = /\(([A-Z][A-Za-z&/]{1,8})\)/g;
    for (const m of text.matchAll(re)) {
        const short = m[1];
        const letters = short.replace(/s$/, "").replace(/[&/]/g, "").toLowerCase();
        if (letters.length < 2 || !/[A-Z].*[A-Z]/.test(short)) continue;
        const before = text.slice(Math.max(0, (m.index ?? 0) - 120), m.index).trimEnd();
        const words = before.split(/\s+/).filter(Boolean);
        for (let take = 1; take <= Math.min(7, words.length); take++) {
            const span = words.slice(words.length - take).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}&]+$/gu, ""));
            if (span.some((w) => !w)) break;
            if (MINOR_WORDS.has(span[0].toLowerCase())) continue;
            if (spellsAcronym(letters, span)) {
                if (!found.has(short)) found.set(short, { short, long: span.join(" ") });
                break;
            }
        }
    }
    return [...found.values()];
}

/** What the rules need from one posting, read once. */
export interface PostingWording {
    /** spellingKey → the posting's own spelling, for single words and two-word terms. */
    spellings: Map<string, string>;
    /** Per verb group: the member the posting uses most, if it uses one it may be written as. */
    verbTargets: (VerbForms | null)[];
    /** Per verb group: every member the posting uses (a line already using one is left alone). */
    verbsUsed: Set<string>[];
    acronyms: Acronym[];
}

export function readPostingWording(postingText: string): PostingWording {
    const spellings = new Map<string, string>();
    const tokens = [...postingText.matchAll(WORD_RE)];
    for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i][0];
        if (isDottedAbbreviation(word)) continue;
        const key = spellingKey(word);
        if (!spellings.has(key)) spellings.set(key, word);
        const next = tokens[i + 1];
        if (!next) continue;
        const gap = postingText.slice((tokens[i].index ?? 0) + word.length, next.index);
        const a = word.toLowerCase();
        const b = next[0].toLowerCase();
        if (gap === " " && joinsAsOneWord(word, next[0]) && !PAIR_FIRST_STOP.has(a) && !PAIR_SECOND_STOP.has(b)) {
            const pairKey = spellingKey(word + next[0]);
            if (!spellings.has(pairKey)) spellings.set(pairKey, `${word} ${next[0]}`);
        }
    }

    const keyCounts = new Map<string, number>();
    for (const t of tokens) keyCounts.set(spellingKey(t[0]), (keyCounts.get(spellingKey(t[0])) ?? 0) + 1);
    const uses = (forms: string[]) => forms.reduce((n, f) => n + (keyCounts.get(spellingKey(f)) ?? 0), 0);

    const verbTargets: (VerbForms | null)[] = [];
    const verbsUsed: Set<string>[] = [];
    for (const group of VERB_GROUPS) {
        let best: VerbForms | null = null;
        let bestCount = 0;
        const used = new Set<string>();
        for (const member of group) {
            const count = uses([member.base, member.past, member.ing, member.s]);
            if (count === 0) continue;
            used.add(member.base);
            if (member.target && count > bestCount) {
                best = member;
                bestCount = count;
            }
        }
        verbTargets.push(best);
        verbsUsed.push(used);
    }

    return { spellings, verbTargets, verbsUsed, acronyms: postingAcronyms(postingText) };
}

function verbFormOf(word: string): { group: number; member: VerbForms; tense: Tense } | null {
    const key = spellingKey(word);
    for (let g = 0; g < VERB_GROUPS.length; g++) {
        for (const member of VERB_GROUPS[g]) {
            for (const tense of ["past", "ing", "s", "base"] as const) {
                if (spellingKey(member[tense]) === key) return { group: g, member, tense };
            }
        }
    }
    return null;
}

/** The posting's verb in the tense the line used; spelled the posting's way
 *  ("analysed" when it writes "analyse"). */
function verbInTense(target: VerbForms, tense: Tense, wording: PostingWording): string {
    const word = target[tense];
    const exact = wording.spellings.get(spellingKey(word))?.toLowerCase();
    if (exact) return exact;
    // The posting writes the base the British way ("analyse"): so the other forms ("analysed").
    const base = wording.spellings.get(spellingKey(target.base))?.toLowerCase();
    if (base && base !== target.base) {
        if (target.base.includes("yz") && base.includes("ys")) return word.replace("yz", "ys");
        if (target.base.includes("iz") && base.includes("is")) return word.replace("iz", "is");
    }
    return word;
}

export interface LineRewording {
    after: string;
    /** The posting's words the line now uses ("document", "customer satisfaction (CSAT)"). */
    terms: string[];
}

export interface RewordContext {
    /** Verbs (base form) already opening a line in this role, before or after rewording. */
    roleOpeners: Set<string>;
    /** Acronyms already written out on the page, so each is spelled out once. */
    acronymsDone: Set<string>;
    /** Whether verb rules apply (résumé lines, not the summary). */
    verbs: boolean;
}

function replaceAt(text: string, start: number, end: number, insert: string): string {
    return text.slice(0, start) + insert + text.slice(end);
}

function rewordOpener(line: string, wording: PostingWording, ctx: RewordContext, terms: string[]): string {
    const lead = line.match(/^\s*/)?.[0].length ?? 0;
    const rest = line.slice(lead);
    const workWith = rest.match(WORK_WITH_RE);
    let group: number;
    let tense: Tense;
    let spanEnd: number;
    let keepTail = "";
    if (workWith) {
        group = WORK_WITH_GROUP;
        const w = workWith[1].toLowerCase();
        tense = w === "worked" ? "past" : w === "working" ? "ing" : w === "works" ? "s" : "base";
        spanEnd = lead + workWith[0].length;
        keepTail = " with";
    } else {
        const first = rest.match(/^\p{L}+/u)?.[0];
        if (!first) return line;
        const form = verbFormOf(first);
        if (!form) return line;
        group = form.group;
        tense = form.tense;
        spanEnd = lead + first.length;
        if (wording.verbsUsed[group].has(form.member.base)) {
            ctx.roleOpeners.add(form.member.base);
            return line;
        }
        const after = line.slice(spanEnd);
        if (PARTICLE_AFTER_RE.test(after) && !(group === WORK_WITH_GROUP && /^\s+with\b/i.test(after))) return line;
    }
    const target = wording.verbTargets[group];
    if (!target || ctx.roleOpeners.has(target.base)) return line;
    const written = verbInTense(target, tense, wording);
    ctx.roleOpeners.add(target.base);
    terms.push(target.base);
    return replaceAt(line, lead, spanEnd, capitalizeLike(rest, written) + keepTail);
}

/** A past or -ing verb right after "and" ("…and charted in Epic"). Base forms
 *  there are too often nouns ("and support staff") to touch. */
function rewordAfterAnd(line: string, wording: PostingWording, terms: string[]): string {
    return line.replace(/(\band\s+)(\p{L}+)(?=((?:\s+\p{L}+){0,2})?)/gu, (whole, and: string, word: string, next: string | undefined) => {
        const form = verbFormOf(word);
        if (!form || (form.tense !== "past" && form.tense !== "ing")) return whole;
        if (next && PARTICLE_AFTER_RE.test(next) && form.group !== WORK_WITH_GROUP) return whole;
        if (wording.verbsUsed[form.group].has(form.member.base)) return whole;
        const target = wording.verbTargets[form.group];
        if (!target) return whole;
        terms.push(target.base);
        return and + capitalizeLike(word, verbInTense(target, form.tense, wording));
    });
}

function rewordSpellings(line: string, wording: PostingWording, terms: string[]): string {
    const tokens = [...line.matchAll(WORD_RE)];
    const edits: { start: number; end: number; text: string }[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const start = tok.index ?? 0;
        const word = tok[0];
        const next = tokens[i + 1];
        if (next && line.slice(start + word.length, next.index) === " " && joinsAsOneWord(word, next[0])) {
            const posting = wording.spellings.get(spellingKey(word + next[0]));
            if (posting && posting.toLowerCase() !== `${word} ${next[0]}`.toLowerCase() && !/\s/.test(posting)) {
                edits.push({ start, end: (next.index ?? 0) + next[0].length, text: inLineCase(word, posting) });
                terms.push(posting);
                i++;
                continue;
            }
        }
        if (isDottedAbbreviation(word)) continue;
        const posting = wording.spellings.get(spellingKey(word));
        if (!posting || posting === word) continue;
        if (posting.toLowerCase() === word.toLowerCase()) {
            // Case only: fix a product's own capitals (GitHub, JavaScript, SQL), never sentence case.
            const camel = hasCamelCase(posting) && !hasCamelCase(word);
            const caps = isAllCaps(posting) && posting.length >= 3 && !/^\p{Ll}+$/u.test(word);
            if (!camel && !caps) continue;
            edits.push({ start, end: start + word.length, text: posting });
            terms.push(posting);
            continue;
        }
        const written = inLineCase(word, posting);
        if (written === word) continue;
        edits.push({ start, end: start + word.length, text: written });
        terms.push(posting);
    }
    let out = line;
    for (const e of edits.reverse()) out = replaceAt(out, e.start, e.end, e.text);
    return out;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewordAcronyms(line: string, wording: PostingWording, ctx: RewordContext, terms: string[]): string {
    let out = line;
    for (const { short, long } of wording.acronyms) {
        if (ctx.acronymsDone.has(short)) continue;
        const longRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(long).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
        const shortRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(short)}(?![\\p{L}\\p{N}])`, "u");
        const hasLong = longRe.exec(out);
        const hasShort = shortRe.exec(out);
        if (hasLong && hasShort) {
            ctx.acronymsDone.add(short);
            continue;
        }
        if (hasLong) {
            const end = hasLong.index + hasLong[0].length;
            out = replaceAt(out, end, end, ` (${short})`);
        } else if (hasShort) {
            if (/^\s*\(/.test(out.slice(hasShort.index + short.length))) continue;
            out = replaceAt(out, hasShort.index, hasShort.index + short.length, `${long} (${short})`);
        } else {
            continue;
        }
        ctx.acronymsDone.add(short);
        terms.push(`${long} (${short})`);
    }
    return out;
}

/** One line in the posting's words, by the rules above; `terms` names what changed. */
export function rewordLine(line: string, wording: PostingWording, ctx: RewordContext): LineRewording {
    const terms: string[] = [];
    let out = line;
    if (ctx.verbs) {
        out = rewordOpener(out, wording, ctx, terms);
        out = rewordAfterAnd(out, wording, terms);
    }
    out = rewordSpellings(out, wording, terms);
    out = rewordAcronyms(out, wording, ctx, terms);
    return { after: out, terms: out === line ? [] : [...new Set(terms)] };
}

/**
 * The posting's words that mean the same as a word the résumé uses, under the
 * rules above: verbs in a group the résumé uses a member of, the posting's
 * spelling of a résumé word, and an acronym's other half. The
 * grounding gate accepts these in a rewrite as it accepts the résumé's own
 * words; nothing else from the posting.
 */
export function equivalentWords(resumeText: string, postingText: string): string[] {
    const wording = readPostingWording(postingText);
    const resumeLower = resumeText.toLowerCase();
    const resumeKeys = new Set([...resumeText.matchAll(WORD_RE)].map((m) => spellingKey(m[0])));
    const out = new Set<string>();
    VERB_GROUPS.forEach((group, g) => {
        const resumeUses = group.some((m) => [m.base, m.past, m.ing, m.s].some((f) => resumeKeys.has(spellingKey(f))))
            || (g === WORK_WITH_GROUP && /\bwork(ed|ing|s)?\s+(closely\s+)?with\b/i.test(resumeText));
        if (!resumeUses) return;
        for (const m of group) if (m.target) for (const f of [m.base, m.past, m.ing, m.s]) out.add(f);
    });
    for (const [key, posting] of wording.spellings) {
        if (resumeKeys.has(key)) for (const w of posting.toLowerCase().split(/[\s-]+/)) out.add(w);
    }
    for (const { short, long } of wording.acronyms) {
        const longIn = new RegExp(escapeRe(long.toLowerCase()).replace(/\s+/g, "\\s+")).test(resumeLower);
        const shortIn = resumeKeys.has(spellingKey(short));
        if (longIn || shortIn) for (const w of `${long} ${short}`.toLowerCase().split(/\s+/)) out.add(w);
    }
    return [...out];
}

/** The base form of the near-synonym verb a line opens with ("Charted" → "chart"), if any. */
export function openingVerbBase(line: string): string | null {
    const rest = line.trimStart();
    if (WORK_WITH_RE.test(rest)) return "work with";
    const first = rest.match(/^\p{L}+/u)?.[0];
    return first ? verbFormOf(first)?.member.base ?? null : null;
}

/** Which group of near-synonym verbs a word is a form of (`VERB_GROUPS`), or null. */
export function verbGroupOf(word: string): number | null {
    return verbFormOf(word)?.group ?? null;
}

/** A skill as the posting spells it ("Patient Counselling" → "Patient Counseling"). */
export function respell(text: string, wording: PostingWording): LineRewording {
    const terms: string[] = [];
    const after = rewordSpellings(text, wording, terms);
    return { after, terms: after === text ? [] : [...new Set(terms)] };
}

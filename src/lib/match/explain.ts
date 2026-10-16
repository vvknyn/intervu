/**
 * The match label's reason in plain English — what the chip's hover says
 * before the receipt rows (MatchChip.tsx). Built from the `MatchScore` itself,
 * never from a model: it has to be instant on hover and can never disagree
 * with the label it explains.
 *
 * Pure, no I/O — same isomorphic convention as score.ts.
 */
import {
    languageText,
    MATCH_BAND_STRONG_MIN,
    matchBand,
    matchBandLabel,
    newToManagingText,
    placeUnclear,
    type MatchComponent,
    type MatchOutside,
    type MatchReason,
    type MatchScore,
    type SeniorityRead,
} from "@/lib/match/score";
import type { Seniority } from "@/lib/jobs/resume-match";
import { contentFamilyLabel } from "@/lib/match/content-family";

/** Seniority verdicts as a clause: "its level fits your experience". */
const LEVEL: Partial<Record<MatchReason, string>> = {
    level_fits: "its level fits your experience",
    level_above_ask: "it's pitched below your level of experience",
    level_below_ask: "it asks for more seniority than your résumé shows",
    level_unlisted: "the posting doesn't say what level it is",
    no_years: "your résumé doesn't show your years of experience",
};

const ROLE_AT: Record<Seniority, string> = { entry: "an entry-level role", mid: "a mid-level role", senior: "a senior role" };
const LEVEL_NOUN: Record<Seniority, string> = { entry: "entry", mid: "mid", senior: "senior" };

/** Where the candidate's level came from: "the mid level of your 5 years as a Technical Account Manager", "the mid level you set in Settings". */
function yourLevel(read: SeniorityRead): string {
    const level = `the ${LEVEL_NOUN[read.own]} level`;
    if (read.ownFrom === "settings") return `${level} you set in Settings`;
    if (read.title) return `${level} of your title, ${read.title}`;
    if (read.years == null) return `${level} of your experience`;
    const years = `${read.years} ${read.years === 1 ? "year" : "years"}`;
    if (!read.role) return `${level} of your ${years} of experience`;
    return `${level} of your ${years} as ${/^[aeiou]/i.test(read.role) ? "an" : "a"} ${read.role}`;
}

/** What made the role the level it is: "it's a senior role", "it asks for 7+ years, which makes it a senior role". */
function roleLevel(read: SeniorityRead): string {
    if (read.jobPastSenior) {
        return read.jobFrom === "title"
            ? "its title (staff, principal, director or head level) puts it past senior"
            : "it's listed as an executive role, which is past senior";
    }
    if (read.jobFrom === "years") return `it asks for ${read.jobYears}+ years, which makes it ${ROLE_AT[read.job]}`;
    if (read.jobFrom !== "title") return `it's ${ROLE_AT[read.job]}`;
    return read.jobRunsTeam ? `its title runs a team, which makes it ${ROLE_AT[read.job]}` : `its title makes it ${ROLE_AT[read.job]}`;
}

/**
 * The level verdict with what each side was read from, so a reader can check
 * it: "it's a senior role, above the mid level of your 5 years as a Technical
 * Account Manager" (Vivek, 2026-10-06: "users should be able to trust our
 * results with why those results were returned").
 */
function levelText(c: MatchComponent): string | null {
    const read = c.level;
    if (!read) return null;
    const role = roleLevel(read);
    if (c.reason === "level_fits" && read.fitsBelow && read.years != null)
        return `${role}, which fits your experience: ${read.years} years, including lead and senior roles`;
    if (c.reason === "level_fits") return `${role}, which matches ${yourLevel(read)}`;
    if (c.reason === "level_below_ask") return `${role}, above ${yourLevel(read)}`;
    if (c.reason === "level_above_ask") return `${role}, below ${yourLevel(read)}`;
    return null;
}

/** Location verdicts as a clause: "it's in your country". */
const PLACE: Partial<Record<MatchReason, string>> = {
    same_country: "it's in your country",
    remote_same_country: "it's remote in your country",
    remote_anywhere: "it's remote and open to people anywhere",
    remote_unplaced: "it's remote but doesn't say which countries it hires in",
    remote_pay_home: "it's remote with no country listed, and it pays in your country's money",
    remote_preferred: "it's remote, as your preferences ask",
    relocation_country: "it's in a country you said you'd move to",
    remote_abroad: "it's remote but based in another country",
    remote_pay_abroad: "it's remote with no country listed, but its pay is in another country's money",
    abroad: "it's in another country",
    country_unlisted: "the posting doesn't say where it's based",
    no_resume_place: "your résumé gives no location to compare",
    resume_place_unmatched: "we couldn't read a country from your résumé's location",
};

/** Clauses that hold the score down, as opposed to ones that support it. */
const WEAK: ReadonlySet<MatchReason> = new Set([
    "level_below_ask",
    "level_unlisted",
    "no_years",
    "remote_abroad",
    "remote_pay_abroad",
    "abroad",
    "country_unlisted",
    "remote_unplaced",
    "no_resume_place",
    "resume_place_unmatched",
]);

/** The level clause with its basis, when the reason is the seniority component's. */
function levelOf(score: MatchScore, reason: MatchReason): string | null {
    const c = component(score, "seniority");
    return c?.reason === reason ? levelText(c) : null;
}

function component(score: MatchScore, key: MatchComponent["key"]): MatchComponent | undefined {
    return score.components.find((c) => c.key === key);
}

/** "the United States", "the Netherlands"; other places as they are. */
function placeName(place: string): string {
    return /^(united|netherlands|philippines)\b/i.test(place) ? `the ${place}` : place;
}

/** "remote — based in Europe" names where; say it rather than "another country". */
function placeText(score: MatchScore, reason: MatchReason): string | null {
    const detail = component(score, "location")?.detail ?? "";
    if (reason === "remote_pay_abroad") {
        const paid = detail.match(/paid in (\S+) — likely for people in (.+)$/);
        return paid ? `it's remote with no country listed, but it pays in ${paid[1]}, so it's likely for people in ${placeName(paid[2]!)}` : null;
    }
    if (reason !== "remote_abroad") return null;
    const where = detail.match(/based in (.+)$/)?.[1];
    return where ? `it's remote but based in ${placeName(where)}` : null;
}

function listed(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
}

/**
 * A role outside every country the candidate can work in: where it is, where
 * they are and what that was read from, and how to count it if they can work
 * there. No fit clauses: its label names the place, not a fit.
 */
function outsideExplanation(score: MatchScore, outside: MatchOutside): string {
    const reason = component(score, "location")?.reason;
    const where = placeName(outside.where);
    const home = `outside ${listed(outside.home.map(placeName))}, where your ${outside.from === "settings" ? "Settings place" : "résumé places"} you`;
    const place =
        reason === "remote_pay_abroad" && outside.currency
            ? `It's remote with no country listed, but it pays in ${outside.currency}, so it's likely for people in ${where}, ${home}.`
            : reason === "remote_abroad"
              ? `It's remote but based in ${where}, ${home}.`
              : `It's in ${where}, ${home}.`;
    // Only what the role is to them; the other role sentences say which fit word it is capped at.
    const role = score.role === "own" || score.role === "family" ? roleSentence(score) : null;
    return [place, role, "If you can work there, add it under Relocation in Settings to see how well it fits."]
        .filter(Boolean)
        .join(" ");
}

/**
 * A role that doesn't say which countries it hires in (`placeUnclear`): that
 * first, since it's why the label isn't a fit word, then what the fit alone
 * would be, so the person can still judge it.
 */
function unclearExplanation(score: MatchScore): string {
    const reason = component(score, "location")?.reason;
    const place =
        reason === "remote_unplaced"
            ? "It's remote but doesn't say which countries it hires in"
            : "The posting doesn't say which country it's in";
    const role = score.role === "own" || score.role === "family" ? roleSentence(score) : null;
    // What the posting asks for, said as it is where the country is known: the terms at full marks, else the share with the terms.
    const share = component(score, "relevance")?.jd ? termsClause(score) : null;
    return [
        `${place}, so there's no telling yet whether you can take it from where you live.`,
        role,
        postingSentence(score),
        share ? sentence([share]) : null,
        `On your résumé alone it would be ${matchBandLabel(matchBand(score.total))}. Check where it hires before you apply.`,
    ]
        .filter(Boolean)
        .join(" ");
}

const POSTING_TERMS_SHOWN = 3;

/** One form of a plural: "roadmaps" and "roadmap", "apis" and "api". */
const termStem = (word: string) => word.replace(/(?<!s)s$/, "");

/**
 * The posting's own terms the résumé shows (`jd.evidenceTerms`, or its responsibilities' own with
 * `"dutyTerms"`; never the words of its title), as a reader would list them: a word a longer listed term
 * already holds is dropped ("management" beside "product management", "rest" and "api" beside "rest api")
 * and a plural is listed once.
 */
function postingTerms(score: MatchScore, kind: "evidenceTerms" | "dutyTerms" | "workTerms" = "evidenceTerms"): string[] {
    const terms = (component(score, "relevance")?.jd?.[kind] ?? []).map((term) => ({
        term,
        words: new Set(term.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean).map(termStem)),
    }));
    return terms
        .filter((a, i) =>
            !terms.some(
                (b, j) => j !== i && [...a.words].every((w) => b.words.has(w)) && (b.words.size > a.words.size || j < i),
            ),
        )
        .map((a) => a.term)
        .slice(0, POSTING_TERMS_SHOWN);
}

/**
 * A title the résumé doesn't name whose posting's day-to-day work shows on the résumé (`MatchScore.contentLed`):
 * say so, with the responsibilities' terms the résumé has (the ones that carried it, not the requirements
 * list's), instead of holding it under Strong for the title.
 */
function contentLedSentence(score: MatchScore): string {
    const terms = postingTerms(score, "dutyTerms");
    const shown = terms.length > 0 ? ` (${listed(terms)})` : "";
    return `It's a title you haven't held, but the posting's day-to-day work shows on your résumé${shown}.`;
}

/**
 * A role held as a Stretch for what it asks of the candidate: a level above theirs, managing people when
 * they haven't, or something the résumé doesn't show (score.ts). Its reason says that first.
 */
const heldAsStretch = (score: MatchScore): boolean =>
    component(score, "seniority")?.reason === "level_below_ask" || Boolean(score.newToManaging) || (score.gaps ?? []).length > 0 || Boolean(score.language);

/**
 * What the posting asks for that the résumé shows, for a role whose title the résumé holds: the title,
 * place and level say nothing about the work, and the daily picks email and the MCP read only this
 * paragraph. One rule for every paragraph that says it (the country-unclear one too): at most three terms,
 * at least two, never for a role held as a Stretch (it says what holds it), and only at full marks, since a
 * fit short of them says its share in `termsClause`, with the terms.
 */
function postingSentence(score: MatchScore): string | null {
    // A content-led title names its terms in the role sentence; another line of work's only shares some words.
    if (score.contentLed || score.role === "off-target" || !score.role) return null;
    if (heldAsStretch(score) || !fullMarks(score)) return null;
    const terms = postingTerms(score);
    return terms.length < 2 ? null : `The posting asks for ${listed(terms)}, which your résumé shows.`;
}

function roleSentence(score: MatchScore): string | null {
    const yours = score.yourRole?.trim();
    if (score.contentLed && (score.role === "adjacent" || score.role === "unverified" || score.role === "off-target")) return contentLedSentence(score);
    switch (score.role) {
        case "own":
            return yours ? `It's your own role: the title matches ${yours} on your résumé.` : "It's your own role.";
        case "family":
            return yours
                ? `It's the same kind of work as your ${yours} role, under a different title.`
                : "It's the kind of role your résumé points to.";
        case "adjacent":
            return yours
                ? `It's a role next to yours (${yours}) rather than the same job, so it can't be a Strong match.`
                : "It's a role next to yours rather than the same job, so it can't be a Strong match.";
        case "unverified":
            // Nothing in the posting showed it is theirs (`unprovenTitle`): say what it lacked and the only words of work it
            // shares, the ones its proof counted (`workTerms`), not the general words it also shares.
            if (score.unproven) {
                const shared = postingTerms(score, "workTerms");
                return `We couldn't tie this title to ${yours ? `your ${yours} role` : "a role on your résumé"}, and its text doesn't show your kind of work${shared.length > 0 ? `: it only shares words like ${listed(shared)} with your résumé` : ""}, so it's a Stretch at most.`;
            }
            return yours
                ? `We couldn't tie this title to your ${yours} role, so it can't be a Strong match.`
                : "We couldn't tie this title to a role on your résumé, so it can't be a Strong match.";
        case "off-target":
            // The posting's text decided it (`contentOffTarget`): say what it reads as and the words that say so.
            if (score.contentFamily) {
                const { id, terms } = score.contentFamily;
                return `The posting reads as ${contentFamilyLabel(id)} work${terms.length > 0 ? ` (${listed(terms)})` : ""}, a different kind of role from ${yours ? `your ${yours} work` : "yours"}, so it's a Stretch at most.`;
            }
            return yours
                ? `It's a different kind of role from your ${yours} work and only shares some words with your résumé, so it's a Stretch at most.`
                : "It's a different kind of role from yours and only shares some words with your résumé, so it's a Stretch at most.";
        default:
            return null;
    }
}

/** Relevance at full marks: no shortfall for `termsClause` to name. */
const fullMarks = (score: MatchScore): boolean => (component(score, "relevance")?.score ?? 0) >= 1;

function termsClause(score: MatchScore): string | null {
    const relevance = component(score, "relevance");
    const terms = relevance?.terms;
    // A shortfall that cost points is a reason; full marks are not.
    if (!relevance || relevance.score >= 1) return null;
    // Once the posting's text has been read, relevance is how much of what it asks the résumé shows, not its title's words.
    if (relevance.jd) {
        const shown = postingTerms(score);
        return `your résumé shows ${Math.round(relevance.jd.fit * 100)}% of what the posting asks for${shown.length > 0 ? ` (${listed(shown)})` : ""}`;
    }
    // Coverage past RELEVANCE_COVERAGE_FLOOR already scores full marks.
    if (!terms || terms.of === 0) return null;
    return `your résumé has ${terms.matched} of the ${terms.of} key words in its title and skills`;
}

const sentence = (clauses: string[]): string => {
    const text = clauses.length > 1 ? `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}` : clauses[0];
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/**
 * One short paragraph: how the title relates to the candidate's own role, what
 * supports the label, and — when it is below Strong — what holds it there. A
 * role outside the candidate's countries says where it is instead, and one
 * that doesn't say where it hires says that.
 */
export function explainMatch(score: MatchScore): string {
    if (score.outside) return outsideExplanation(score, score.outside);
    if (placeUnclear(score)) return unclearExplanation(score);
    const level = component(score, "seniority")?.reason;
    const place = component(score, "location")?.reason;
    const clauses = [place, level]
        .filter((reason): reason is MatchReason => Boolean(reason))
        .map((reason) => ({ reason, text: placeText(score, reason) ?? levelOf(score, reason) ?? LEVEL[reason] ?? PLACE[reason] ?? "" }))
        .filter((c) => c.text);
    // A role the posting's text puts in another line of work, or whose text shows none of the résumé's (`unproven`), says
    // that and stops: "your résumé shows 99% of what it asks for" beside "a different kind of role" would read as the
    // opposite (the share is of its words, not its work).
    const terms = score.contentFamily || score.unproven ? null : termsClause(score);

    const support = clauses.filter((c) => !WEAK.has(c.reason)).map((c) => c.text);
    const weak = clauses.filter((c) => WEAK.has(c.reason)).map((c) => c.text);
    const managing = [
        ...(score.newToManaging ? [newToManagingText(component(score, "seniority")?.level)] : []),
        ...(score.gaps ?? []).map((gap) => gap.text),
        ...(score.language ? [languageText(score.language)] : []),
    ];

    const parts: string[] = [];
    const role = roleSentence(score);
    if (role) parts.push(role);
    const posting = postingSentence(score);
    if (posting) parts.push(posting);
    if (support.length > 0) parts.push(sentence(support));
    // The role sentence already says why an adjacent, unverified or off-target role
    // is held down; otherwise a below-Strong label is explained by what's against it.
    const heldByRole = !score.contentLed && (score.role === "adjacent" || score.role === "unverified" || score.role === "off-target");
    // A role above the candidate's level, or managing people when they haven't, is a Stretch for that
    // reason (score.ts), whatever else it has: say that first, and the key words after it on their own.
    if (heldAsStretch(score)) {
        const held = [...weak, ...managing];
        // Those clauses carry commas of their own, so a comma comes before the last "and".
        const reasons = held.length > 1 ? `${held.slice(0, -1).join(", ")}, and ${held[held.length - 1]}` : held[0]!;
        parts.push(
            heldByRole
                ? sentence([reasons])
                : `It's a Stretch because ${reasons}.`,
        );
        if (terms) parts.push(sentence([terms]));
    } else {
        const against = [...(terms ? [terms] : []), ...weak];
        if (against.length > 0) {
            parts.push(
                score.total < MATCH_BAND_STRONG_MIN && !heldByRole
                    ? `It isn't a Strong match because ${against.join(" and ")}.`
                    : sentence([against.join(" and ")]),
            );
        }
    }
    if (parts.length === 0) return `${matchBandLabel(matchBand(score.total))} against your résumé.`;
    return parts.join(" ");
}

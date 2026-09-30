/**
 * The match label's reason in plain English — what the chip's hover says
 * before the receipt rows (MatchChip.tsx). Built from the `MatchScore` itself,
 * never from a model: it has to be instant on hover and can never disagree
 * with the label it explains.
 *
 * Pure, no I/O — same isomorphic convention as score.ts.
 */
import { MATCH_BAND_STRONG_MIN, matchBand, matchBandLabel, type MatchComponent, type MatchReason, type MatchScore } from "@/lib/match/score";

/** Seniority verdicts as a clause: "its level fits your experience". */
const LEVEL: Partial<Record<MatchReason, string>> = {
    level_fits: "its level fits your experience",
    level_above_ask: "it's pitched below your level of experience",
    level_below_ask: "it asks for more seniority than your résumé shows",
    level_unlisted: "the posting doesn't say what level it is",
    no_years: "your résumé doesn't show your years of experience",
};

/** Location verdicts as a clause: "it's in your country". */
const PLACE: Partial<Record<MatchReason, string>> = {
    same_country: "it's in your country",
    remote_same_country: "it's remote in your country",
    remote_anywhere: "it's remote with no country listed",
    remote_preferred: "it's remote, as your preferences ask",
    relocation_country: "it's in a country you said you'd move to",
    remote_abroad: "it's remote but based in another country",
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
    "abroad",
    "country_unlisted",
    "no_resume_place",
    "resume_place_unmatched",
]);

function component(score: MatchScore, key: MatchComponent["key"]): MatchComponent | undefined {
    return score.components.find((c) => c.key === key);
}

/** "remote — based in Europe" names where; say it rather than "another country". */
function placeText(score: MatchScore, reason: MatchReason): string | null {
    if (reason !== "remote_abroad") return null;
    const where = component(score, "location")?.detail.match(/based in (.+)$/)?.[1];
    return where ? `it's remote but based in ${/^(united|netherlands|philippines)\b/i.test(where) ? "the " : ""}${where}` : null;
}

function roleSentence(score: MatchScore): string | null {
    const yours = score.yourRole?.trim();
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
            return yours
                ? `We couldn't tie this title to your ${yours} role, so it can't be a Strong match.`
                : "We couldn't tie this title to a role on your résumé, so it can't be a Strong match.";
        case "off-target":
            return yours
                ? `It's a different kind of role from your ${yours} work and only shares some words with your résumé, so it's a Stretch at most.`
                : "It's a different kind of role from yours and only shares some words with your résumé, so it's a Stretch at most.";
        default:
            return null;
    }
}

function termsClause(score: MatchScore): string | null {
    const relevance = component(score, "relevance");
    const terms = relevance?.terms;
    // Coverage past RELEVANCE_COVERAGE_FLOOR already scores full marks: only a shortfall that cost points is a reason.
    if (!relevance || !terms || terms.of === 0 || relevance.score >= 1) return null;
    return `your résumé has ${terms.matched} of the ${terms.of} key words in its title and skills`;
}

const sentence = (clauses: string[]): string => {
    const text = clauses.length > 1 ? `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}` : clauses[0];
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/**
 * One short paragraph: how the title relates to the candidate's own role, what
 * supports the label, and — when it is below Strong — what holds it there.
 */
export function explainMatch(score: MatchScore): string {
    const level = component(score, "seniority")?.reason;
    const place = component(score, "location")?.reason;
    const clauses = [level, place]
        .filter((reason): reason is MatchReason => Boolean(reason))
        .map((reason) => ({ reason, text: placeText(score, reason) ?? LEVEL[reason] ?? PLACE[reason] ?? "" }))
        .filter((c) => c.text);
    const terms = termsClause(score);

    const support = clauses.filter((c) => !WEAK.has(c.reason)).map((c) => c.text);
    const against = [...(terms ? [terms] : []), ...clauses.filter((c) => WEAK.has(c.reason)).map((c) => c.text)];

    const parts: string[] = [];
    const role = roleSentence(score);
    if (role) parts.push(role);
    if (support.length > 0) parts.push(sentence(support));
    if (against.length > 0) {
        // The role sentence already says why an adjacent, unverified or off-target role
        // is held down; otherwise a below-Strong label is explained by what's against it.
        const heldByRole = score.role === "adjacent" || score.role === "unverified" || score.role === "off-target";
        parts.push(
            score.total < MATCH_BAND_STRONG_MIN && !heldByRole
                ? `It isn't a Strong match because ${against.join(" and ")}.`
                : sentence([against.join(" and ")]),
        );
    }
    if (parts.length === 0) return `${matchBandLabel(matchBand(score.total))} against your résumé.`;
    return parts.join(" ");
}

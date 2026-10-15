/**
 * Target titles named by a search, and whether a posting's title names one of them (`jobTitleMatchesTarget`).
 * This decides which family a title belongs to (`roleAffinity`), which caps a fit and breaks a tie; it never
 * orders a list. The deck used to move title matches ahead of every other card (`partitionByTargetTitle`):
 * removed 2026-10-15 with the rule "content first, title last", so the title order cannot return.
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts.
 */
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { RANK_WORDS } from "@/lib/match/duty-signals";

/**
 * Split a query into the target titles it names — quoted ("A" OR "B", the
 * fit-phrase lane's own format, fit-phrases.ts) or plain (A OR B, what a
 * typed or agent-set query looks like before any lane rewrites it), one
 * title, or none. Deliberately more permissive than fit-phrases.ts's
 * `parseQuotedOrPhrases`: that function gates a different, stricter
 * retrieval lane and rejects unquoted input on purpose; this only reads
 * display-order titles out of whatever query actually ran, so a plain
 * typed "A OR B" still names two targets.
 */
export function targetTitlesFromQuery(q: string | null | undefined): string[] {
    const trimmed = (q ?? "").trim();
    if (!trimmed) return [];
    return trimmed
        .split(/\s+OR\s+/i)
        .map((part) => part.trim().replace(/^"|"$/g, "").trim())
        .filter(Boolean);
}

/**
 * A title's significant tokens for target-title matching: `meaningfulTitleTokens`
 * (presentation.ts — lowercases, strips punctuation, strips function words)
 * with rank/seniority words (`RANK_WORDS`, duty-signals.ts) also dropped.
 * Rank words are a separate match dimension (`scoreSeniority`, match/score.ts
 * already compares résumé years against the job's level) — a "Sr." target
 * must still find a "Senior" job title and vice versa, so neither side's
 * rank word is ever required.
 */
function titleMatchTokens(title: string): string[] {
    return meaningfulTitleTokens(title).filter((t) => !RANK_WORDS.has(t));
}

/**
 * One title word against one target word: the same word, or a plural of it
 * either way ("manager"/"managers", "analyst"/"analysts", "class"/"classes").
 * Deliberately NOT a prefix match: a target is a whole role title the
 * candidate named (their headline, their role, a title they asked for), never
 * a word still being typed, and prefix tolerance read "Production Manager" as
 * a Product Manager's own role, "Salesforce Administrator" as a Sales
 * Associate's, "Nursery Teacher" as a Nurse's and "Database Analyst" as a
 * Data Analyst's (review, 2026-10-13).
 */
function sameTitleWord(jobToken: string, targetToken: string): boolean {
    return (
        jobToken === targetToken ||
        jobToken === `${targetToken}s` ||
        jobToken === `${targetToken}es` ||
        targetToken === `${jobToken}s` ||
        targetToken === `${jobToken}es`
    );
}

/** `target` appears as a contiguous, in-order run inside `tokens`. */
function containsRun(tokens: readonly string[], target: readonly string[]): boolean {
    for (let start = 0; start + target.length <= tokens.length; start++) {
        if (target.every((t, i) => sameTitleWord(tokens[start + i]!, t))) return true;
    }
    return false;
}

/**
 * The orders a title can be read in: as written, and each comma rotation of
 * it, so an inverted title reads the way it is said — "Engineer, Software" is
 * a Software Engineer, "Customer Success Manager, Technical" a Technical
 * Customer Success Manager, "Senior Manager, Product" a Product Manager.
 */
function titleReadings(jobTitle: string): string[][] {
    const segments = jobTitle.split(",").map((s) => s.trim()).filter(Boolean);
    const readings = [titleMatchTokens(jobTitle)];
    for (let k = 1; k < segments.length; k++) {
        readings.push(titleMatchTokens([...segments.slice(k), ...segments.slice(0, k)].join(" ")));
    }
    return readings;
}

/**
 * True iff the significant tokens of `targetTitle` appear in `jobTitle` as a
 * contiguous, in-order run of whole words (plurals tolerated), in the title as
 * written or read with a comma inversion undone (`titleReadings`). Rank words
 * are dropped from both sides first (`titleMatchTokens`), so "Sr. Product
 * Manager II" is a Product Manager and a "Senior" target still finds an
 * unranked title.
 *
 * Before 2026-10-13 this was an order-insensitive, prefix-tolerant bag of
 * words, so every title that merely CONTAINED the target's words counted as
 * the candidate's own role: "Product Marketing Manager", "Product Operations
 * Manager" and "Product Development Manager" for a Product Manager (all three
 * are retrieved by the Product Manager lane, which matches words, not
 * phrases), "Manager, Technical Account Management" for a Technical Account
 * Manager, "Registered Practical Nurse" (a different licence) for a
 * Registered Nurse, and "Software Engineering Manager" for a Software
 * Engineer. An own-role match ranks first in every pack (`roleTier`), so each
 * of those led the list.
 *
 * An empty target (nothing significant left after stripping function/rank
 * words) never matches — there's nothing left to require.
 */
export function jobTitleMatchesTarget(jobTitle: string, targetTitle: string): boolean {
    const targetTokens = titleMatchTokens(targetTitle);
    if (targetTokens.length === 0) return false;
    return titleReadings(jobTitle).some((tokens) => containsRun(tokens, targetTokens));
}

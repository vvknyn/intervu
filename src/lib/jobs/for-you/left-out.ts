/**
 * Why a scored role is not recommended to this résumé, or `null` when it is: ONE rule, read from the
 * score alone, so it is the same for any role or industry and the same on every surface that
 * recommends (For You, Today, the daily picks, the MCP `for_you` and `daily_picks` tools).
 *
 * A recommendation list is not a search: a person typing a title sees every role that has it, but a
 * list the product volunteers must hold only roles they could take. A role is left out when:
 *  - `abroad`: it is in, or remote from, a country the candidate can't work in, or names none and pays
 *    in another country's money;
 *  - `unplaced`: nothing says the candidate can take it from where they are: their own country can't
 *    be read, or the role names nowhere it hires (`placeUnknown`). A pick needs evidence, not the
 *    absence of a limit: "Remote" alone was read as open to anyone, so US-only roles were picks for
 *    people in Canada (2026-10-05). The deck keeps such a role last, with its caveat (`keepUnplaced`);
 *  - `level`: it asks for more seniority than the résumé shows (Staff, Principal, Director, Head of,
 *    a level above theirs), or its title manages people and nothing on the résumé shows managing anyone
 *    (`MatchScore.newToManaging`);
 *  - `requirement`: it asks for what the résumé doesn't show: more years than they have in the line of
 *    work, a language, a clearance, a certification, managing people, selling, or most of the skills it
 *    requires (`MatchScore.gaps`, requirement-gaps.ts);
 *  - `other-role`: the role is a different kind of job than any the résumé shows (`MatchScore.role`
 *    "off-target": the title names a line of work that is none of theirs). A title the résumé doesn't
 *    name (a neighbour, or a title tied to no known role) stays: that is how a person finds roles
 *    they haven't heard of but are qualified for, and the score already holds it under Strong;
 *  - `stretch`: under Good against the résumé.
 *
 * Search itself never uses this: typing "Staff Product Manager" still finds every Staff Product Manager.
 */
import { candidatePlaceUnread, matchBand, OUTSIDE_REASONS, outsideLevel, placeUnknown, type MatchScore } from "@/lib/match/score";

export type ForYouLeftOut = "stretch" | "other-role" | "level" | "abroad" | "unplaced" | "requirement";

export interface LeftOutOptions {
    /**
     * A candidate whose country can't be read (no location on the résumé) has no role to check a place against:
     * Today leaves every role out for that and asks where they can work, but a list that is open anyway keeps them.
     */
    keepWhenCandidatePlaceUnread?: boolean;
    /**
     * A list that shows the role with its caveat instead of hiding it: a role that names no place it hires (a bare
     * "Remote") stays, and the rank puts it after every role whose place is clear. Today and the daily picks keep it
     * out (a pick needs evidence); the deck and the MCP list say "country not stated" on the row.
     */
    keepUnplaced?: boolean;
}

export function forYouLeftOut(score: MatchScore, options: LeftOutOptions = {}): ForYouLeftOut | null {
    // First: its total is held under Good for the place alone (`MatchScore.outside`), not for the fit.
    if (score.outside || score.components.some((c) => c.reason != null && OUTSIDE_REASONS.has(c.reason))) return "abroad";
    if (placeUnknown(score) && !options.keepUnplaced && !(options.keepWhenCandidatePlaceUnread && candidatePlaceUnread(score))) return "unplaced";
    // Before the band: a role above their level, or managing people when they haven't, is a Stretch for that reason (score.ts).
    if (score.newToManaging || outsideLevel(score) || score.components.some((c) => c.reason === "level_below_ask")) return "level";
    // Likewise a role that asks for what the résumé doesn't show.
    if (score.gaps && score.gaps.length > 0) return "requirement";
    // Before the band: a different kind of role is capped under Good for that, and "a different kind of role" says more than "a weaker fit".
    // An adjacent or unfamiliar title is not a different kind of role: the content of the posting decides, and the title only orders.
    if (score.role === "off-target") return "other-role";
    if (matchBand(score.total) === "stretch") return "stretch";
    return null;
}

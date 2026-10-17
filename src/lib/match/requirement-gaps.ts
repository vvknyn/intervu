/**
 * What a posting asks that the résumé does not show: the hard asks (`JdAsks`, read from the description) and
 * the years it wants, weighed against the résumé.
 *
 * A HARD gap is an explicit ask the résumé either shows or doesn't: more years than they have, a language,
 * a clearance, managing people, selling, a named certification. A role with one is not for this person
 * whatever its title and vocabulary share with their résumé: a Stretch at most (score.ts), left out of For
 * You, Today and the daily picks (left-out.ts), with the reason on its receipt.
 *
 * A SOFT gap (`RequirementGap.soft`) is a coverage ratio read from words: most of the required skills
 * missing, fewer than half of the requirement lines answered. It caps the role at Stretch and orders it
 * below the roles the résumé covers, with the reason on the row, but it is a ranking signal, not an ask,
 * so it is not a reason to leave the role out. And it fires only for a résumé that says enough to judge
 * (`COVERAGE_MIN_RESUME_TERMS`): a four-skill, one-line software engineer résumé failed it on 99 of 100
 * software postings, so For You and Today held nothing (release gate, 2026-10-15). What a short résumé does
 * not show is not what its owner cannot do.
 *
 * Generic: it reads only the posting's stated asks and what the résumé says, never a list of industries.
 * An ask the posting makes optional (an asset, a plus, preferred) is never read as one (jd-asks.ts), and a
 * posting that states none has no gaps.
 */
import { resumeSeniorityBasis } from "@/lib/jobs/resume-match";
import { resumeManagedPeople, yearsAsked } from "@/lib/jobs/role-level";
import { jdTermsOf, resumeShowsTerm, resumeTermSet } from "@/lib/match/jd-match";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type RequirementGapKind = "years" | "language" | "clearance" | "managing" | "selling" | "credential" | "skills" | "requirements";

export interface RequirementGap {
    kind: RequirementGapKind;
    /** A coverage ratio read from words, not an explicit ask: a ranking signal that caps the role at Stretch, never a reason to leave it out. */
    soft?: true;
    /** What the receipt says, as a clause: "it asks for French and nothing on your résumé shows it". */
    text: string;
}

/**
 * Distinct words and phrases a résumé must say before the coverage gaps judge a posting against it (about six
 * lines of experience). Below it the résumé cannot show a posting's tools and requirements whatever its owner
 * can do: the shortest fixtures run 41 to 100, the four real-length résumés 485 to 757.
 */
export const COVERAGE_MIN_RESUME_TERMS = 150;

/** Years above what the résumé shows in the line of work that a posting may still ask: employers round up. */
export const YEARS_MARGIN = 2;
/**
 * A posting's required skills are a gap when it lists at least this many and the résumé shows no more than
 * this share of them: a list from another line of work. A list of tools the résumé lacks (Zendesk, Salesforce)
 * in the résumé's own line is ordinary, learned on the job, and is not.
 */
export const MUST_SKILLS_MIN_LISTED = 4;
export const MUST_SKILLS_MAX_SHOWN_SHARE = 1 / 3;

/**
 * A posting's requirements are a gap when it lists at least this many bullets and fewer than this share of
 * them show anything of the résumé: read one line at a time, a posting half of whose asks the résumé has no
 * answer for is not this person's line of work, however many of its other words they share.
 */
export const REQUIREMENT_BULLETS_MIN = 4;
export const REQUIREMENT_BULLETS_MIN_SHOWN_SHARE = 0.5;

/** Evidence on a résumé that its owner has sold: a quota, prospecting, business development. "Sales" alone is partnering with sales. */
const SELLING_EVIDENCE = ["quota", "prospecting", "cold calling", "business development", "new business", "outbound", "account executive", "sdr", "bdr"];
const CLEARANCE_EVIDENCE = ["clearance", "reliability status", "secret clearance"];

const list = (items: string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0]!);
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How many of the skills a posting requires (its "must" list) the résumé shows: `{ listed: 0, shown: 0 }` when it lists none. */
export function requiredSkillsShown(resume: ResumeData, job: Pick<PublicJob, "jd_terms" | "description" | "company" | "location" | "must_have_skills" | "preferred_skills" | "skills_section_found">): { listed: number; shown: number } {
    const must = jdTermsOf(job)?.asks?.must ?? [];
    return { listed: must.length, shown: must.filter((skill) => resumeShowsTerm(resume, skill, { loose: true })).length };
}

export function requirementGaps(
    resume: ResumeData,
    job: Pick<PublicJob, "min_years_experience" | "jd_terms" | "description" | "company" | "location" | "must_have_skills" | "preferred_skills" | "skills_section_found">,
    /** The languages they read in (`CandidateSignals.languages`): one the posting asks for that they chose is no gap, whatever the résumé shows. */
    languages: readonly string[] = [],
): RequirementGap[] {
    const gaps: RequirementGap[] = [];

    // The years the posting's structured field says, else the years its text asks (the field is on about half the postings).
    const asks = jdTermsOf(job)?.asks;
    const asked = yearsAsked(job.min_years_experience) ?? yearsAsked(asks?.years);
    const basis = resumeSeniorityBasis(resume);
    const have = basis ? Math.round(basis.lineYears ?? basis.years) : null;
    const margin = YEARS_MARGIN + (basis?.led ? 1 : 0);
    if (asked != null && have != null && asked > have + margin) {
        gaps.push({ kind: "years", text: `it asks for ${asked}+ years and your résumé shows ${have} ${basis!.lineYears != null || basis!.role ? "in this line of work" : "in all"}` });
    }

    if (!asks) return gaps;

    const missingLangs = (asks.langs ?? []).filter((lang) => !languages.includes(lang) && !resumeShowsTerm(resume, lang));
    if (missingLangs.length > 0) gaps.push({ kind: "language", text: `it asks for ${list(missingLangs.map(titleCase))} and nothing on your résumé shows it` });

    if (asks.clearance && !CLEARANCE_EVIDENCE.some((term) => resumeShowsTerm(resume, term))) {
        gaps.push({ kind: "clearance", text: "it requires a security clearance and nothing on your résumé shows one" });
    }

    if (asks.manages && !resumeManagedPeople(resume)) {
        gaps.push({ kind: "managing", text: "it has you managing people, which no role on your résumé shows you doing" });
    }

    if (asks.sells && !SELLING_EVIDENCE.some((term) => resumeShowsTerm(resume, term))) {
        gaps.push({ kind: "selling", text: "it is a selling job (quota, prospecting) and nothing on your résumé shows selling" });
    }

    const missingCreds = (asks.creds ?? []).filter((cred) => !resumeShowsTerm(resume, cred));
    if (missingCreds.length > 0) gaps.push({ kind: "credential", text: `it requires ${list(missingCreds)}, which your résumé does not show` });

    // The coverage gaps below judge the résumé by what it says; a résumé that says little cannot be judged that way.
    if (resumeTermSet(resume).size < COVERAGE_MIN_RESUME_TERMS) return gaps;

    const must = asks.must ?? [];
    const missingSkills = must.filter((skill) => !resumeShowsTerm(resume, skill, { loose: true }));
    if (must.length >= MUST_SKILLS_MIN_LISTED && (must.length - missingSkills.length) / must.length <= MUST_SKILLS_MAX_SHOWN_SHARE) {
        gaps.push({ kind: "skills", soft: true, text: `most of the skills it requires are not on your résumé (${list(missingSkills.slice(0, 3))})` });
    }
    const bullets = asks.bullets ?? [];
    if (bullets.length >= REQUIREMENT_BULLETS_MIN) {
        const unanswered = bullets.filter((terms) => !terms.some((term) => resumeShowsTerm(resume, term, { loose: true })));
        if ((bullets.length - unanswered.length) / bullets.length < REQUIREMENT_BULLETS_MIN_SHOWN_SHARE) {
            const named = unanswered.slice(0, 2).map((terms) => terms[0]!);
            gaps.push({ kind: "requirements", soft: true, text: `fewer than half of its requirements show on your résumé (${list(named)}${unanswered.length > 2 ? ", …" : ""})` });
        }
    }
    return gaps;
}

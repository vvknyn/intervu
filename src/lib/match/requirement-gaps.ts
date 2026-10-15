/**
 * What a posting asks that the résumé does not show: the hard asks (`JdAsks`, read from the description) and
 * the years it wants, weighed against the résumé. Each gap is a reason a role is not for this person, whatever
 * its title and vocabulary share with their résumé, so a role with one is a Stretch at most (score.ts), is
 * left out of For You, Today and the daily picks, and says so on its receipt.
 *
 * Generic: it reads only the posting's stated asks and what the résumé says, never a list of industries.
 * An ask the posting makes optional (an asset, a plus, preferred) is never read as one (jd-asks.ts), and a
 * posting that states none has no gaps.
 */
import { resumeSeniorityBasis } from "@/lib/jobs/resume-match";
import { resumeManagedPeople, yearsAsked } from "@/lib/jobs/role-level";
import { jdTermsOf, resumeShowsTerm } from "@/lib/match/jd-match";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type RequirementGapKind = "years" | "language" | "clearance" | "managing" | "selling" | "credential" | "skills" | "requirements";

export interface RequirementGap {
    kind: RequirementGapKind;
    /** What the receipt says, as a clause: "it asks for French and nothing on your résumé shows it". */
    text: string;
}

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

export function requirementGaps(resume: ResumeData, job: Pick<PublicJob, "min_years_experience" | "jd_terms" | "description" | "company" | "location" | "must_have_skills" | "preferred_skills" | "skills_section_found">): RequirementGap[] {
    const gaps: RequirementGap[] = [];

    const asked = yearsAsked(job.min_years_experience);
    const basis = resumeSeniorityBasis(resume);
    const have = basis ? Math.round(basis.lineYears ?? basis.years) : null;
    if (asked != null && have != null && asked > have + YEARS_MARGIN) {
        gaps.push({ kind: "years", text: `it asks for ${asked}+ years and your résumé shows ${have} ${basis!.lineYears != null || basis!.role ? "in this line of work" : "in all"}` });
    }

    const asks = jdTermsOf(job)?.asks;
    if (!asks) return gaps;

    const missingLangs = (asks.langs ?? []).filter((lang) => !resumeShowsTerm(resume, lang));
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

    const must = asks.must ?? [];
    const missingSkills = must.filter((skill) => !resumeShowsTerm(resume, skill, { loose: true }));
    if (must.length >= MUST_SKILLS_MIN_LISTED && (must.length - missingSkills.length) / must.length <= MUST_SKILLS_MAX_SHOWN_SHARE) {
        gaps.push({ kind: "skills", text: `most of the skills it requires are not on your résumé (${list(missingSkills.slice(0, 3))})` });
    }
    const bullets = asks.bullets ?? [];
    if (bullets.length >= REQUIREMENT_BULLETS_MIN) {
        const unanswered = bullets.filter((terms) => !terms.some((term) => resumeShowsTerm(resume, term)));
        if ((bullets.length - unanswered.length) / bullets.length < REQUIREMENT_BULLETS_MIN_SHOWN_SHARE) {
            const named = unanswered.slice(0, 2).map((terms) => terms[0]!);
            gaps.push({ kind: "requirements", text: `fewer than half of its requirements show on your résumé (${list(named)}${unanswered.length > 2 ? ", …" : ""})` });
        }
    }
    return gaps;
}

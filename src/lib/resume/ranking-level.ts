/**
 * "Level used for ranking" on the résumé review: the level every fit label
 * reads (`resolveCandidateSignals(...).seniority`), worded with what it came
 * from, so the number the person sees is the one ranking uses.
 *
 * Vivek, 2026-10-10, on the review showing "Years of Experience 13": "it is
 * not pulling up relevant experience for that role". Ranking already read his
 * level from his 5 years as a Technical Account Manager (`resumeSeniorityBasis`),
 * not the 13 in total, but nothing on the review said so or which roles counted.
 *
 * Pure: the preferences import is type-only.
 */
import type { AgentPreferences } from "@/lib/agent/preferences";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import { resumeSeniorityBasis, type Seniority, type SeniorityBasis } from "@/lib/jobs/resume-match";
import type { ResumeData } from "@/types/resume";

export interface RankingLevel {
    /** The level ranking compares roles against; null when neither Settings nor the résumé tells it. */
    level: Seniority | null;
    from: "settings" | "resume" | null;
    /** What the level was read from, in one or two sentences. */
    detail: string;
    /** The résumé's roles (indexes into `experience`) the years were counted from; empty when every role counts or Settings decides. */
    countedRoles: number[];
}

export const LEVEL_LABEL: Record<Seniority, string> = { entry: "Entry level", mid: "Mid level", senior: "Senior level" };

const yearsText = (n: number) => `${n} ${n === 1 ? "year" : "years"}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** "your 5 years as a Technical Account Manager" / "your 13 years of experience". */
function yearsBasisText(basis: SeniorityBasis): string {
    return basis.role
        ? `your ${yearsText(basis.years)} as ${article(basis.role)} ${basis.role}`
        : basis.led
          ? `your ${yearsText(basis.years)} of experience, including lead and senior roles, which carry your level up into the role you hold now`
          : `your ${yearsText(basis.years)} of experience`;
}

/** `yearsBasisText`, or "your title, Senior Accountant" when the title held now set the level. */
function basisText(basis: SeniorityBasis): string {
    return basis.title ? `your title, ${basis.title}` : yearsBasisText(basis);
}

export function rankingLevel(
    resume: ResumeData,
    prefs: AgentPreferences | null | undefined,
    now: Date = new Date(),
): RankingLevel {
    const seniority = resolveCandidateSignals(resume, prefs).seniority;
    const fromResume = resumeSeniorityBasis(resume, now);

    if (seniority.source === "explicit" && seniority.value) {
        const setting = prefs?.search.experienceLevel ?? "";
        const stated = setting.charAt(0).toUpperCase() + setting.slice(1);
        const resumeReads = fromResume
            ? `Your résumé alone reads ${LEVEL_LABEL[fromResume.level].toLowerCase()}, from ${basisText(fromResume)}.`
            : "Your résumé alone doesn't show your years.";
        return {
            level: seniority.value,
            from: "settings",
            detail: `From the Experience level you set in Settings (${stated}), which comes before your résumé. ${resumeReads}`,
            countedRoles: [],
        };
    }

    if (!fromResume) {
        return {
            level: null,
            from: null,
            detail: "Ranking can't tell your level yet. Add dates to your roles, or your years of experience, and it will.",
            countedRoles: [],
        };
    }

    if (fromResume.title) {
        return {
            level: fromResume.level,
            from: "resume",
            detail: `From your title, ${fromResume.title}, the role marked below. A title means the same level on your résumé as on a posting, so it comes before ${yearsBasisText(fromResume)}.`,
            countedRoles: [0],
        };
    }

    if (fromResume.role) {
        const counted = fromResume.roles ?? [];
        const marked = counted.length === 1 ? "the role marked below" : "the roles marked below";
        const total = resume.profile?.yearsOfExperience ?? 0;
        return {
            level: fromResume.level,
            from: "resume",
            detail: `From ${basisText(fromResume)}, ${marked}. Employers ask for years in the role, so your other roles count toward your ${yearsText(total)} in total, not this level.`,
            countedRoles: counted,
        };
    }

    return {
        level: fromResume.level,
        from: "resume",
        detail: `From ${basisText(fromResume)}.`,
        countedRoles: [],
    };
}

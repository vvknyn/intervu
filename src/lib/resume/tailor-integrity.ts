/**
 * The actual guarantee behind built-in résumé tailoring: intervu exists in
 * opposition to autofill that invents credentials nobody claimed
 * (`ApplyIntentDialog.tsx:29-36`). A prompt telling the model "don't invent
 * anything" is not that guarantee — models drift. This module is: it diffs
 * the model's proposal against the user's own original résumé and REVERTS
 * (never merely flags) anything that doesn't already exist there.
 *
 * Pure function, no Firestore, no LLM, no "use server" — directly
 * unit-testable, and the only place this decision is made. Every rung below
 * matches spec `docs/specs/2026-08-22-apply-resume-package.md` Section A2.
 */

import type {
    ResumeData,
    ResumeExperience,
    ResumeCompetencyCategory,
    TailoringRecommendation,
} from "@/types/resume";
import { normalizeForMatch } from "@/lib/resume/apply-recommendations";

export interface IntegrityVerdict {
    tailored: {
        summary: string;
        experience: ResumeExperience[];
        competencies: ResumeCompetencyCategory[];
    };
    dropped: TailoringRecommendation[];
    violations: string[];
}

/**
 * Numeric tokens worth policing in tailored prose: percentages, currency,
 * k/M-shorthand ("12k", "3M") or spelled out ("10 million"), and bare
 * integers of two or more (0 and 1 are too common as trivial counts/list
 * markers to be a fabricated metric).
 *
 * The unit letter only counts as a unit when it isn't the start of a longer
 * word — `(?![a-z])` — otherwise "3 backend engineers" or "5 marketing
 * campaigns" reads as the invented number "3b"/"5m" and a purely cosmetic
 * reword gets wrongly reverted. Spelled-out magnitudes are recognised
 * explicitly (not just single letters) so "10 million" still normalizes to
 * the same token as "10M" and a genuine invention like "10 users" -> "10
 * million users" is still caught.
 */
const METRIC_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|million|billion|thousand|[kmb](?![a-z]))?/gi;

const MAGNITUDE_WORD_SHORTHAND: Record<string, string> = { thousand: "k", million: "m", billion: "b" };

function extractMetricTokens(text: string | undefined): string[] {
    if (!text) return [];
    const matches = text.match(METRIC_TOKEN_RE) ?? [];
    return matches
        .map((raw) => raw.replace(/\s+/g, "").replace(/,/g, "").toLowerCase())
        .map((tok) => tok.replace(/thousand|million|billion/, (word) => MAGNITUDE_WORD_SHORTHAND[word]))
        .filter((tok) => {
            const value = parseFloat(tok.replace(/[^0-9.]/g, ""));
            if (Number.isNaN(value)) return false;
            const hasUnit = /[%$kmb]/.test(tok);
            return hasUnit || value >= 2; // bare 0/1 ignored
        });
}

/** A 4-digit token in the ordinary calendar-year range — exempted from the
 *  invented-number check when it comes from the entry's own `dates` field,
 *  per A2 rule 2's "ignore ... ordinary years already present". */
function isYearLikeToken(tok: string): boolean {
    return /^(19|20)\d{2}$/.test(tok);
}

/** Everything the model was shown as "already true" — the original résumé's
 *  full text, flattened and normalized. Used to test whether a tailored
 *  fragment (a skill, an employer mention) already existed somewhere in the
 *  original rather than being invented. Single source for rules 4 and 5. */
function originalKnowledgeBlob(original: ResumeData): string {
    return normalizeForMatch(
        [
            original.generatedSummary,
            ...original.experience.flatMap((e) => [e.company, e.role, e.description]),
            ...original.competencies.flatMap((c) => [c.category, ...c.skills]),
        ]
            .filter(Boolean)
            .join(" \n "),
    );
}

function containsPhrase(blob: string, phrase: string): boolean {
    const needle = normalizeForMatch(phrase);
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(blob);
}

/** Rule 1 (identity) + rule 2 (no invented numbers). The tailored set must
 *  carry exactly the original ids; any addition, omission, or company/role/
 *  dates drift reverts that entry wholesale, and an intact entry still
 *  reverts wholesale if its description introduces a number absent from its
 *  own original description (or an ordinary year from its own `dates`). */
function reconcileExperience(
    original: ResumeExperience[],
    proposed: ResumeExperience[] | undefined,
): { experience: ResumeExperience[]; revertedIds: Set<string>; violations: string[] } {
    const violations: string[] = [];
    const revertedIds = new Set<string>();
    if (!proposed) {
        return { experience: original, revertedIds, violations };
    }

    const originalIds = new Set(original.map((e) => e.id));
    for (const cand of proposed) {
        if (!originalIds.has(cand.id)) {
            violations.push(`experience: invented entry id "${cand.id}" not in original — dropped`);
        }
    }

    const proposedById = new Map(proposed.map((e) => [e.id, e]));
    const experience = original.map((orig) => {
        const cand = proposedById.get(orig.id);
        if (!cand) {
            violations.push(`experience "${orig.id}": missing from proposal — reverted to original`);
            revertedIds.add(orig.id);
            return orig;
        }
        const identityIntact =
            cand.company.trim() === orig.company.trim() &&
            cand.role.trim() === orig.role.trim() &&
            cand.dates.trim() === orig.dates.trim();
        if (!identityIntact) {
            violations.push(`experience "${orig.id}": company/role/dates changed — reverted wholesale`);
            revertedIds.add(orig.id);
            return orig;
        }

        const allowedNumbers = new Set([
            ...extractMetricTokens(orig.description),
            ...extractMetricTokens(orig.dates).filter(isYearLikeToken),
        ]);
        const invented = extractMetricTokens(cand.description).filter((tok) => !allowedNumbers.has(tok));
        if (invented.length > 0) {
            violations.push(
                `experience "${orig.id}": invented number(s) ${invented.join(", ")} — reverted wholesale`,
            );
            revertedIds.add(orig.id);
            return orig;
        }

        return { ...orig, description: cand.description };
    });

    return { experience, revertedIds, violations };
}

/** Rule 4 — every tailored skill must already appear (case-insensitive,
 *  trimmed) in the original competencies, or anywhere in the original
 *  experience descriptions or summary. Unmatched skills are dropped from
 *  their category; categories left empty are dropped too. */
function reconcileCompetencies(
    original: ResumeData,
    proposed: ResumeCompetencyCategory[] | undefined,
    blob: string,
): { competencies: ResumeCompetencyCategory[]; removedSkills: Set<string>; violations: string[] } {
    const violations: string[] = [];
    const removedSkills = new Set<string>();
    if (!proposed) {
        return { competencies: original.competencies, removedSkills, violations };
    }

    const originalSkills = new Set(
        original.competencies.flatMap((c) => c.skills.map((s) => normalizeForMatch(s))),
    );
    const competencies = proposed
        .map((cat) => {
            const skills = cat.skills.filter((skill) => {
                const known = originalSkills.has(normalizeForMatch(skill)) || containsPhrase(blob, skill);
                if (!known) {
                    violations.push(`skills: invented skill "${skill}" removed from "${cat.category}"`);
                    removedSkills.add(normalizeForMatch(skill));
                }
                return known;
            });
            return { ...cat, skills };
        })
        .filter((cat) => cat.skills.length > 0);

    return { competencies, removedSkills, violations };
}

/** Matches a company mention in the grammatical slot it actually occurs in
 *  résumé prose ("... at Stripe", "led growth for Notion") — targeted at
 *  employer names rather than an unbounded stoplist of ordinary capitalized
 *  words, which would need to enumerate every verb a summary might start
 *  with. */
const EMPLOYER_MENTION_RE = /\b(?:at|for|with|by|joined|from)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/g;

/** Rule 5 — the summary may not introduce an employer absent from the
 *  original experience, nor a number absent from the original summary +
 *  experience. Either violation reverts the whole summary to the original. */
function reconcileSummary(
    original: ResumeData,
    proposedSummary: string | undefined,
    blob: string,
): { summary: string; reverted: boolean; violations: string[] } {
    if (proposedSummary === undefined) {
        return { summary: original.generatedSummary, reverted: false, violations: [] };
    }

    EMPLOYER_MENTION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EMPLOYER_MENTION_RE.exec(proposedSummary))) {
        // Strip a sentence-ending period ("... at Acme Corp.") — the capture
        // group allows an internal "." for abbreviations like "Inc.", but a
        // trailing one is punctuation, not part of the name.
        const candidate = match[1].replace(/\.$/, "");
        if (!containsPhrase(blob, candidate)) {
            return {
                summary: original.generatedSummary,
                reverted: true,
                violations: [`summary: mentions unrecognized employer "${candidate}" — reverted`],
            };
        }
    }

    const allowedNumbers = new Set([
        ...extractMetricTokens(original.generatedSummary),
        ...original.experience.flatMap((e) => extractMetricTokens(e.description)),
    ]);
    const invented = extractMetricTokens(proposedSummary).filter((tok) => !allowedNumbers.has(tok));
    if (invented.length > 0) {
        return {
            summary: original.generatedSummary,
            reverted: true,
            violations: [`summary: invented number(s) ${invented.join(", ")} — reverted`],
        };
    }

    return { summary: proposedSummary, reverted: false, violations: [] };
}

/** A recommendation whose `suggested` content was reverted by any rule above
 *  moves to `dropped`. Correlation to a specific experience entry reuses the
 *  same normalized-substring anchor `applyRecommendations` already matches
 *  recommendations against, rather than inventing a second matching scheme. */
function findDroppedRecommendations(
    recommendations: TailoringRecommendation[],
    original: ResumeData,
    revertedExperienceIds: Set<string>,
    summaryReverted: boolean,
    removedSkills: Set<string>,
): TailoringRecommendation[] {
    return recommendations.filter((rec) => {
        if (rec.category === "summary") return summaryReverted;
        if (rec.category === "skills") return removedSkills.has(normalizeForMatch(rec.suggested));
        if (rec.category === "experience") {
            if (revertedExperienceIds.size === 0 || !rec.original) return false;
            const owner = original.experience.find((e) =>
                normalizeForMatch(e.description).includes(normalizeForMatch(rec.original!)),
            );
            return owner ? revertedExperienceIds.has(owner.id) : false;
        }
        return false; // 'overall' recs are advisory — nothing to revert against.
    });
}

export function enforceResumeIntegrity(
    original: ResumeData,
    proposed: { summary?: string; experience?: ResumeExperience[]; competencies?: ResumeCompetencyCategory[] },
    recommendations: TailoringRecommendation[],
): IntegrityVerdict {
    const violations: string[] = [];

    // Rule 3 — profile/education are never sent to the model and must never
    // come back. The TS type already excludes them; this guards the runtime
    // JSON in case the model includes them anyway.
    const proposedAny = proposed as Record<string, unknown>;
    if ("profile" in proposedAny) violations.push("proposal included 'profile' — ignored");
    if ("education" in proposedAny) violations.push("proposal included 'education' — ignored");

    const blob = originalKnowledgeBlob(original);

    const experienceResult = reconcileExperience(original.experience, proposed.experience);
    violations.push(...experienceResult.violations);

    const competenciesResult = reconcileCompetencies(original, proposed.competencies, blob);
    violations.push(...competenciesResult.violations);

    const summaryResult = reconcileSummary(original, proposed.summary, blob);
    violations.push(...summaryResult.violations);

    const dropped = findDroppedRecommendations(
        recommendations,
        original,
        experienceResult.revertedIds,
        summaryResult.reverted,
        competenciesResult.removedSkills,
    );

    return {
        tailored: {
            summary: summaryResult.summary,
            experience: experienceResult.experience,
            competencies: competenciesResult.competencies,
        },
        dropped,
        violations,
    };
}

/**
 * Advisory mode (spec A1's `TailorMode`) has no `ResumeData` to diff — the
 * base résumé is plain text, so there is nothing to revert. But the same
 * guarantee still has to hold for the *advice* itself: a recommendation must
 * not tell the user to lead with a metric or an employer that never appears
 * in their résumé text. Reuses the exact primitives the structured path uses
 * above (`extractMetricTokens`, `containsPhrase`, `EMPLOYER_MENTION_RE`) so
 * "is this fact already in the résumé" has exactly one definition — biased
 * toward keeping, since advisory mode's recommendations are the only value
 * that user gets: only a concrete invented metric or employer drops one.
 */
export function screenAdvisoryRecommendations(
    resumeText: string,
    recommendations: TailoringRecommendation[],
): { kept: TailoringRecommendation[]; dropped: TailoringRecommendation[] } {
    const blob = normalizeForMatch(resumeText);
    const allowedNumbers = new Set(extractMetricTokens(resumeText));

    const kept: TailoringRecommendation[] = [];
    const dropped: TailoringRecommendation[] = [];

    for (const rec of recommendations) {
        const proposedText = `${rec.title} ${rec.suggested}`;

        const inventedNumber = extractMetricTokens(proposedText).some((tok) => !allowedNumbers.has(tok));

        let inventedEmployer = false;
        EMPLOYER_MENTION_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = EMPLOYER_MENTION_RE.exec(proposedText))) {
            const candidate = match[1].replace(/\.$/, "");
            if (!containsPhrase(blob, candidate)) {
                inventedEmployer = true;
                break;
            }
        }

        (inventedNumber || inventedEmployer ? dropped : kept).push(rec);
    }

    return { kept, dropped };
}

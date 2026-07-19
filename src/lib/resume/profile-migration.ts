/**
 * Backward-compat read-time migration for `ResumeProfile`.
 *
 * Before this fix, the résumé-parsing prompt had no `name` field in the schema
 * and was explicitly instructed to put the candidate's full name into
 * `profession` (see src/actions/resume.ts). So every already-saved profile has
 * the person's real name sitting in `profession`, and no `profession` field ever
 * held an actual job title.
 *
 * This function is the single place that reshapes that legacy data: if `name`
 * is empty but `profession` is populated, the `profession` value is moved to
 * `name` (never dropped) and `profession` is cleared (we never actually
 * extracted a real job title for these records, so leaving it blank is honest —
 * inventing one would be a lying fallback). Already-correct profiles (both
 * fields populated, or both empty) pass through unchanged.
 *
 * Called once at the read chokepoint (`fetchResumeData`); the migrated shape
 * gets persisted back automatically the next time the user saves, so no bulk
 * backfill is needed. Pure — no I/O — unit-testable in isolation.
 */

import type { ResumeProfile } from "@/types/resume";

export function migrateLegacyProfile(profile: ResumeProfile): ResumeProfile {
    if (profile.name?.trim() || !profile.profession?.trim()) {
        return profile;
    }

    return {
        ...profile,
        name: profile.profession,
        profession: "",
    };
}

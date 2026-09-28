/**
 * Candidate city/region for pack apply.
 *
 * The live pack path used to turn `resume_data.profile.location` into a
 * country facet and then drop Canada, so a city that was actually on the
 * résumé never reached tailored apply. This module keeps that city/region
 * on the apply payload and the résumé that gets tailored. It does not
 * invent a place, and it does not add a Canada country facet — Canada
 * listings stay off the deck.
 */
import { omitCanadaCountryFacet } from "@/lib/jobs/for-you/canada-deck";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import { sanitizeLocation } from "@/lib/resume/contact-line";
import { locationFromResumePlainText } from "@/lib/resume/structure-resume-text";
import type { FacetKey } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export interface PackApplyPayload {
    /** Sanitized city/region from the résumé. Null when the résumé has none. */
    candidateLocation: string | null;
}

type LocationResume = {
    profile?: { location?: string | null } | null;
    generatedSummary?: string | null;
    experience?: { description?: string | null }[] | null;
    projects?: { description?: string | null }[] | null;
};

function bodyText(resume: LocationResume): string {
    return [
        resume.generatedSummary ?? "",
        ...(resume.experience ?? []).map((entry) => entry.description ?? ""),
        ...(resume.projects ?? []).map((entry) => entry.description ?? ""),
    ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n");
}

/**
 * City/region the résumé actually contains.
 * `profile.location` wins. If that field is empty, a place line later in
 * the stored text is used. No match → "".
 */
export function candidateLocationFromResume(resume: LocationResume | null | undefined): string {
    if (!resume) return "";
    const direct = sanitizeLocation(resume.profile?.location);
    if (direct) return direct;
    const fromBody = locationFromResumePlainText(bodyText(resume));
    return fromBody || "";
}

export function buildPackApplyPayload(resume: LocationResume | null | undefined): PackApplyPayload {
    const location = candidateLocationFromResume(resume);
    return { candidateLocation: location || null };
}

/** Résumé handed to tailored pack apply, with the candidate place filled in when one exists. */
export function resumeForPackApply(resume: ResumeData): ResumeData {
    const location = buildPackApplyPayload(resume).candidateLocation ?? "";
    if ((resume.profile.location ?? "") === location) return resume;
    return {
        ...resume,
        profile: {
            ...resume.profile,
            location,
        },
    };
}

function cityToken(place: string): string | null {
    const parts = place
        .split(/[,;|·•/]/)
        .map((part) => part.trim())
        .filter(Boolean);
    for (const part of parts) {
        const countries = deriveResumeLocationFacets(part).location_country ?? [];
        if (countries.length > 0) continue;
        if (part.length < 2) continue;
        return part;
    }
    return null;
}

/**
 * Location facets the pack search may send.
 * Non-Canada country facets stay. A city is included when the place is not
 * in Canada, so a Canada-wide facet is never what scopes the deck.
 * A résumé with no place contributes nothing.
 */
export function packApplyLocationFacets(
    resume: LocationResume | null | undefined,
): Partial<Record<FacetKey, string[]>> {
    const place = candidateLocationFromResume(resume);
    if (!place) return {};
    const country = omitCanadaCountryFacet(deriveResumeLocationFacets(place));
    const inferred = deriveResumeLocationFacets(place).location_country ?? [];
    const inCanada = inferred.some((name) => /canada/i.test(name));
    const city = inCanada ? null : cityToken(place);
    const facets: Partial<Record<FacetKey, string[]>> = { ...country };
    if (city) facets.location_city = [city];
    return facets;
}

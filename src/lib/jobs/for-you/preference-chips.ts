import type { SearchPreferences } from "@/lib/agent/preferences";
import { normaliseLocation, placeHasSegment } from "@/lib/presentation/location-normalise";
import type { ResumeData } from "@/types/resume";

export interface PreferenceChip {
    key: string;
    label: string;
}

export interface FitFacetHints {
    experienceLevel?: string | null;
    location?: string | null;
    salaryMin?: number | null;
    remote?: boolean | null;
}

function formatSalary(min: number | undefined): string | null {
    if (!min || min <= 0) return null;
    if (min >= 1_000_000) return `$${Math.round(min / 1_000_000)}M+`;
    if (min >= 1_000) return `$${Math.round(min / 1_000)}k+`;
    return `$${min}+`;
}

function prettyLevel(raw: string | undefined | null): string | null {
    if (!raw?.trim()) return null;
    return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build preference chip labels from agent search prefs, résumé fallbacks,
 * and optional fit-derived facets.
 */
export function buildPreferenceChips(input: {
    search: SearchPreferences;
    resume: ResumeData | null;
    fitFacets?: FitFacetHints;
}): PreferenceChip[] {
    const chips: PreferenceChip[] = [];
    const { search, resume, fitFacets } = input;

    const role =
        search.query?.trim() ||
        resume?.profile?.profession?.trim() ||
        null;
    if (role) chips.push({ key: "role", label: role });

    const level =
        prettyLevel(search.experienceLevel) ||
        prettyLevel(fitFacets?.experienceLevel) ||
        null;
    if (level) chips.push({ key: "level", label: level });

    const whereRaw =
        search.location?.trim() ||
        fitFacets?.location?.trim() ||
        resume?.profile?.location?.trim() ||
        null;
    const where = whereRaw ? normaliseLocation(whereRaw) : null;
    if (where) chips.push({ key: "where", label: where });

    const wantsRemoteChip = search.remoteOnly || fitFacets?.remote;
    const locationAlreadyRemote = where != null && placeHasSegment(where, "Remote");
    if (wantsRemoteChip && !locationAlreadyRemote) {
        chips.push({ key: "remote", label: "Remote only" });
    }

    const pay =
        formatSalary(search.salaryMin) ||
        (fitFacets?.salaryMin ? formatSalary(fitFacets.salaryMin) : null);
    if (pay) chips.push({ key: "pay", label: pay });

    return chips;
}

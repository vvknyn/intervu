/**
 * Where a saved search preference came from — isomorphic (no Admin SDK), so
 * both the server store (preferences.ts) and the browser's fit signals
 * (candidate-signals.ts) read the same rule.
 *
 * A résumé fills the synced fields the person never set (resume-preferences.ts)
 * so Settings and their agent show what it says; a value it filled is not a
 * statement of intent, so fit reads the résumé itself for it and a résumé never
 * outranks the one that replaced it (review, 2026-10-13).
 */
import type { SearchPreferences } from "./preferences";

/** The search fields a résumé can fill. */
export const RESUME_SYNCED_FIELDS = ["query", "location", "experienceLevel"] as const;
export type ResumeSyncedField = (typeof RESUME_SYNCED_FIELDS)[number];

/** Who set a synced field's current value: the person (Settings, setup, their agent) or their résumé. */
export type PreferenceSource = "user" | "resume";

export type PreferenceSources = Partial<Record<ResumeSyncedField, PreferenceSource>>;

/** The search preferences the person stated themselves: the saved ones minus any synced field a résumé filled. */
export function statedSearch(prefs: { search: SearchPreferences; sources?: PreferenceSources }): SearchPreferences {
    const search = { ...prefs.search };
    for (const field of RESUME_SYNCED_FIELDS) if (prefs.sources?.[field] === "resume") delete search[field];
    return search;
}

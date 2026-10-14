/**
 * A listing whose place fields hold a word that names no place. The feed's
 * HTML extractor read the tail of "Customer Success Manager, Spanish &
 * English" (Atlassian, San Francisco or remote) as its city, and the row
 * then carried a country of its own guessing (Canada): a US role read as
 * one Vivek could take from Toronto (2026-10-14). The rest of such a row's
 * place can't be trusted either, so all of it is dropped: unknown, which
 * no pack or Today counts as a place the candidate can work.
 */
import type { PublicJob } from "@/lib/jobs/types";

const LANGUAGES = [
    "english", "spanish", "french", "german", "portuguese", "italian", "dutch", "polish", "russian", "ukrainian",
    "turkish", "arabic", "hebrew", "hindi", "urdu", "bengali", "punjabi", "tamil", "telugu", "mandarin", "cantonese",
    "chinese", "japanese", "korean", "vietnamese", "thai", "indonesian", "malay", "tagalog", "filipino", "swedish",
    "norwegian", "danish", "finnish", "greek", "czech", "slovak", "hungarian", "romanian", "bulgarian", "croatian",
    "serbian", "farsi", "persian", "swahili", "bilingual", "multilingual", "trilingual",
];

const NON_PLACE = new RegExp(`^(?:(?:${LANGUAGES.join("|")})(?:\\s*(?:[&/,+-]|and)\\s*)?)+(?:\\s+(?:speaking|speaker|language|fluent))?$`, "i");

/** Whether a place field holds only language words ("Spanish", "Spanish & English", "Bilingual"). */
export function isNonPlaceWord(value: string | null | undefined): boolean {
    const v = (value ?? "").trim();
    return v.length > 0 && NON_PLACE.test(v);
}

/** The job with a non-place city or location dropped, and with it the place the row guessed from it. */
export function withoutNonPlaceLocation<T extends PublicJob>(job: T): T {
    if (!isNonPlaceWord(job.location_city) && !isNonPlaceWord(job.location)) return job;
    return { ...job, location: null, location_city: null, location_state: null, location_country: null };
}

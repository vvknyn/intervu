/**
 * A résumé's bare city ("Mississauga") is a question for the user, never a
 * guess: `structureResumeText` keeps it in `profile.unconfirmedPlaces`
 * while `location` stays blank (so no country filter applies), and the
 * For-you prompt asks which place it is.
 */
import type { LoadResult } from "@/lib/load-result";
import type { ResumeData, ResumeProfile } from "@/types/resume";

/** Bare places still waiting on the user — none once the résumé has a location. */
export function placesToConfirm(profile: ResumeProfile): string[] {
    return profile.location ? [] : (profile.unconfirmedPlaces ?? []);
}

/**
 * The question to ask: the first name `readPlaces` knows as one or more
 * places, with all of them. A name it does not know ("TypeScript") or a read
 * that failed asks nothing — the name stays unconfirmed, no location is set.
 */
export async function findPlaceToConfirm(
    names: readonly string[],
    readPlaces: (name: string) => Promise<LoadResult<string[]>>,
): Promise<{ name: string; places: string[] } | null> {
    for (const name of names) {
        const res = await readPlaces(name);
        if (res.ok && res.data.length > 0) return { name, places: res.data };
    }
    return null;
}

/** The user's answer settles the question: the place they chose, or `""` for none of these. */
export function settlePlace(resume: ResumeData, location: string): ResumeData {
    const profile: ResumeProfile = { ...resume.profile, location };
    delete profile.unconfirmedPlaces;
    return { ...resume, profile };
}

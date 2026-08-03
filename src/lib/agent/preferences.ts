/**
 * Cookie-free read/write of the caller's agent preferences at
 * `profiles/<uid>.agent_preferences` — same shape convention as
 * `lib/resume/base-resume.ts` (read) and `lib/pursuits/resume-version.ts`
 * (write): `uid` is supplied directly by the caller rather than resolved
 * from a cookie session, so the bearer-token MCP tools `get_preferences`/
 * `set_preferences` (`lib/agent/tools.ts`) can read/write it without
 * depending on `getServerUser()`'s cookie-session mechanism.
 *
 * These are the caller's own saved job-search preferences and standing
 * application answers, shared across every AI client paired to their
 * account — the pure shape/merge decisions below (`shapeAgentPreferences`,
 * `mergeAgentPreferences`) have zero Firestore imports so they're
 * unit-testable directly; the two exported I/O functions stay thin wrappers
 * around them.
 *
 * Plain module (not "use server"): imports the Admin SDK directly, so it
 * must only ever be imported from server code.
 */
import { getAdminDb } from "@/lib/firebase/admin";

export interface SearchPreferences {
    query?: string;
    location?: string;
    remoteOnly?: boolean;
    experienceLevel?: string;
    employmentType?: string;
    salaryMin?: number;
    postedWithinDays?: number;
}

export interface AnswerPreferences {
    workAuthorization?: string;
    relocation?: string;
    noticePeriod?: string;
    startDate?: string;
    salaryExpectation?: string;
    custom: Record<string, string>;
}

export interface AgentPreferences {
    configured: boolean;
    search: SearchPreferences;
    answers: AnswerPreferences;
    updated_at?: string;
}

export interface AgentPreferencesPatch {
    search?: Partial<SearchPreferences>;
    /** A `custom` entry set to `null` deletes that key on merge (see
     *  `mergeAgentPreferences`) — `undefined` can't signal this since it
     *  doesn't survive JSON over the MCP wire and the Admin SDK rejects a
     *  literal `undefined` field value on write. */
    answers?: Partial<Omit<AnswerPreferences, "custom">> & { custom?: Record<string, string | null> };
}

/**
 * Shapes whatever sits at `profiles/<uid>.agent_preferences` into an
 * `AgentPreferences` — defensively, since `stored` is a raw Firestore field
 * that may be absent, `undefined`, or a partial/malformed shape left behind
 * by an earlier version of this feature. Absent/falsy means genuinely
 * nothing saved yet (`configured: false`, empty sections) — never a
 * fabricated default. Present means `configured: true` with every section
 * carried through defensively (`custom` defaults to `{}` even if the stored
 * doc never had one), never a throw on a merely-incomplete stored shape.
 */
export function shapeAgentPreferences(stored: unknown): AgentPreferences {
    if (!stored || typeof stored !== "object") {
        return { configured: false, search: {}, answers: { custom: {} } };
    }
    const doc = stored as {
        search?: SearchPreferences;
        answers?: Partial<AnswerPreferences>;
        updated_at?: string;
    };
    return {
        configured: true,
        search: { ...doc.search },
        answers: { ...doc.answers, custom: { ...doc.answers?.custom } },
        updated_at: doc.updated_at,
    };
}

/**
 * Per-SECTION and per-FIELD merge of a patch onto existing preferences. A
 * patch section that's absent passes the existing section through
 * untouched (setting `answers` alone must never touch `search`, and vice
 * versa); a patch section that's present merges field-by-field so a lone
 * changed field never drops its siblings. `answers.custom` merges
 * key-by-key for the same reason — adding one custom Q&A must never drop
 * previously-saved ones — with one exception: a key patched to `null` is
 * dropped from the merged result rather than stored, which is how a caller
 * deletes a custom Q&A (see `AgentPreferencesPatch.answers.custom`'s doc
 * comment). The stored/returned `custom` is therefore always
 * `Record<string, string>` — the `null` sentinel never survives past this
 * function. Always returns `configured: true` and a fresh `updated_at`,
 * since a merge only ever happens on an actual set.
 */
export function mergeAgentPreferences(
    existing: AgentPreferences,
    patch: AgentPreferencesPatch,
): AgentPreferences {
    return {
        configured: true,
        search: patch.search ? { ...existing.search, ...patch.search } : existing.search,
        answers: patch.answers
            ? {
                  ...existing.answers,
                  ...patch.answers,
                  custom: Object.fromEntries(
                      Object.entries({ ...existing.answers.custom, ...patch.answers.custom }).filter(
                          ([, v]) => v !== null,
                      ),
                  ) as Record<string, string>,
              }
            : existing.answers,
        updated_at: new Date().toISOString(),
    };
}

export async function getAgentPreferences(uid: string): Promise<AgentPreferences> {
    const db = getAdminDb();
    const doc = await db.collection("profiles").doc(uid).get();
    return shapeAgentPreferences(doc.exists ? doc.data()?.agent_preferences : undefined);
}

export async function setAgentPreferences(
    uid: string,
    patch: AgentPreferencesPatch,
): Promise<AgentPreferences> {
    const existing = await getAgentPreferences(uid);
    const merged = mergeAgentPreferences(existing, patch);
    const db = getAdminDb();
    await db.collection("profiles").doc(uid).set(
        { agent_preferences: { search: merged.search, answers: merged.answers, updated_at: merged.updated_at } },
        { merge: true },
    );
    return merged;
}

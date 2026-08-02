/**
 * Write/read seam for resume-version snapshots filed against a pursuit
 * (see `ResumeVersionSnapshot` in `./types`). `uid` is supplied directly by
 * the caller rather than resolved from a cookie session — same shape as
 * `assertUnderDailyApplyCap` in `./apply-cap.ts` — so both cookie-session
 * web callers (`actions/applications.ts`) and a bearer-token MCP tool can
 * call these exact functions without either depending on the other's auth
 * mechanism.
 *
 * Plain module (not "use server"): it imports the Admin SDK directly, so it
 * must only ever be imported from server code. Pure shape/validation lives
 * in `buildResumeVersionSnapshot` below and in `orderResumeVersionsLatestFirst`
 * (`./types`, which has zero I/O imports and is safe for client components)
 * — kept out of `./types.ts` here only because it doesn't need to be.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { orderResumeVersionsLatestFirst, type ResumeVersionSnapshot } from "@/lib/pursuits/types";

/**
 * Validates and shapes a snapshot from raw input. Rejects empty/whitespace
 * content or label rather than storing a blank placeholder — a pursuit with
 * no real resume on file must show the empty state, never a snapshot that
 * lies about having content (no lying fallbacks).
 */
export function buildResumeVersionSnapshot(
    content: string,
    label: string,
    savedAtIso: string = new Date().toISOString(),
): { data?: ResumeVersionSnapshot; error?: string } {
    const trimmedContent = content?.trim();
    const trimmedLabel = label?.trim();
    if (!trimmedContent) return { error: "Resume content is required" };
    if (!trimmedLabel) return { error: "A label is required" };
    return { data: { content: trimmedContent, label: trimmedLabel, saved_at: savedAtIso } };
}

/**
 * Save an immutable resume-version snapshot onto a pursuit. Appends to the
 * pursuit's `resume_versions` array rather than overwriting, so re-filing a
 * resume for the same pursuit keeps every prior version on file —
 * `getResumeVersionForPursuit` returns them latest-first. The snapshot's
 * `content` is copied verbatim at call time; nothing about this function
 * ever mutates a previously-saved entry.
 */
export async function saveResumeVersionForPursuit(
    uid: string,
    pursuitId: string,
    input: { content: string; label: string },
): Promise<{ data?: ResumeVersionSnapshot; error?: string }> {
    const built = buildResumeVersionSnapshot(input.content, input.label);
    if (!built.data) return { error: built.error || "Invalid resume version" };

    const db = getAdminDb();
    const docRef = db.collection("applications").doc(pursuitId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.user_id !== uid) {
        return { error: "Pursuit not found" };
    }

    const existing: ResumeVersionSnapshot[] = doc.data()?.resume_versions ?? [];
    await docRef.update({
        resume_versions: [...existing, built.data],
        updated_at: new Date().toISOString(),
    });

    return { data: built.data };
}

/**
 * Read the resume-version snapshots filed against a pursuit, latest first.
 * Returns an empty array — never an error — when the pursuit exists but has
 * none on file, so callers render the "no resume on file" empty state
 * rather than fabricating a placeholder.
 */
export async function getResumeVersionForPursuit(
    uid: string,
    pursuitId: string,
): Promise<{ data?: ResumeVersionSnapshot[]; error?: string }> {
    const db = getAdminDb();
    const doc = await db.collection("applications").doc(pursuitId).get();
    if (!doc.exists || doc.data()?.user_id !== uid) {
        return { error: "Pursuit not found" };
    }

    const versions: ResumeVersionSnapshot[] = doc.data()?.resume_versions ?? [];
    return { data: orderResumeVersionsLatestFirst(versions) };
}

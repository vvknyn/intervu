/**
 * Cookie-free read of the caller's base résumé at `profiles/<uid>` — same
 * shape convention as `lib/pursuits/resume-version.ts`'s write/read seam:
 * `uid` is supplied directly by the caller rather than resolved from a
 * cookie session, so a bearer-token MCP tool (`get_resume`, `lib/agent/tools.ts`)
 * can read it without depending on `getServerUser()`'s cookie-session
 * mechanism the existing web actions use (`fetchResumeData`, `actions/resume.ts`).
 *
 * Mirrors `fetchResumeData`'s read chokepoint — same legacy name/profession
 * migration (`migrateLegacyProfile`) — but adds the canonical-source decision
 * an MCP tool needs: `resume_data` wins whenever it has real content
 * (`hasResumeContent`, the SAME check the resume builder itself uses to
 * decide "is anything here yet"), else the plain-text `resume_text`
 * fallback, else an explicit "none". Never fabricates a placeholder résumé.
 *
 * Plain module (not "use server"): imports the Admin SDK directly, so it
 * must only ever be imported from server code.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { hasResumeContent } from "@/lib/resume/has-content";
import { migrateLegacyProfile } from "@/lib/resume/profile-migration";
import { hasPaidAccess } from "@/lib/billing/access";
import type { ResumeData } from "@/types/resume";

export type BaseResume =
    | { source: "resume_data"; resume_data: ResumeData }
    | { source: "resume_text"; resume_text: string }
    /** Stored, but the account has no paid month: only the fact that a résumé is saved leaves the server, never its text. */
    | { source: "locked" }
    | { source: "none" };

/**
 * The canonical-source decision, pulled out as a pure function (no
 * Firestore) so it's unit-testable directly — same reasoning as
 * `buildResumeVersionSnapshot` (resume-version.ts) and `mergeGuestPursuit`
 * (pursuits/types.ts). `resumeData` wins whenever `hasResumeContent` says it has
 * real content; otherwise a non-blank `resumeText` (trimmed) is the
 * fallback; otherwise an honest "none" rather than a fabricated résumé.
 */
export function canonicalizeBaseResume(
    resumeData: ResumeData | undefined,
    resumeText: string | undefined,
): BaseResume {
    if (resumeData && hasResumeContent(resumeData)) {
        return { source: "resume_data", resume_data: resumeData };
    }
    const trimmed = resumeText?.trim();
    if (trimmed) return { source: "resume_text", resume_text: trimmed };
    return { source: "none" };
}

/** Shared doc fetch behind both `getBaseResumeForUser` (the MCP-facing seam
 *  — unchanged shape, other tools depend on it) and
 *  `getBaseResumeSummaryForUser` (adds `updatedAt` for the Settings card),
 *  so there's exactly one place that reads `profiles/<uid>` for this and one
 *  place that decides the canonical source. */
export async function fetchBaseResumeDoc(
    uid: string,
    isPaid: (uid: string) => Promise<boolean> = hasPaidAccess,
    read: (uid: string) => Promise<{ base: BaseResume; updatedAt: string | null }> = readBaseResumeDoc,
): Promise<{ base: BaseResume; updatedAt: string | null }> {
    // The one server-side reader of the stored résumé for MCP, daily picks, Settings and the applied-role copy.
    // An unpaid account is told that a résumé is saved ("locked"), never what it says.
    const stored = await read(uid);
    return (await isPaid(uid)) ? stored : lockedOf(stored);
}

/** What an unpaid account may learn of a stored résumé: that one exists, and when it was saved. */
export function lockedOf(stored: { base: BaseResume; updatedAt: string | null }): { base: BaseResume; updatedAt: string | null } {
    return stored.base.source === "none" ? stored : { base: { source: "locked" }, updatedAt: stored.updatedAt };
}

async function readBaseResumeDoc(uid: string): Promise<{ base: BaseResume; updatedAt: string | null }> {
    const db = getAdminDb();
    const doc = await db.collection("profiles").doc(uid).get();
    if (!doc.exists) return { base: { source: "none" }, updatedAt: null };

    const docData = doc.data();
    const resumeData = docData?.resume_data as ResumeData | undefined;
    if (resumeData?.profile) {
        resumeData.profile = migrateLegacyProfile(resumeData.profile);
    }
    const base = canonicalizeBaseResume(resumeData, docData?.resume_text as string | undefined);
    return { base, updatedAt: (docData?.resume_last_updated as string | undefined) ?? null };
}

export async function getBaseResumeForUser(uid: string): Promise<BaseResume> {
    return (await fetchBaseResumeDoc(uid)).base;
}

/**
 * `getBaseResumeForUser`'s result plus `resume_last_updated` (written by
 * both `saveResumeData` (`actions/resume.ts`) and `setBaseResumeForUser`
 * (`set-resume.ts`) on every write) — the "when was this last touched" fact
 * the Settings résumé card needs that no MCP tool currently cares about.
 */
export async function getBaseResumeSummaryForUser(uid: string): Promise<BaseResume & { updatedAt: string | null }> {
    const { base, updatedAt } = await fetchBaseResumeDoc(uid);
    return { ...base, updatedAt };
}

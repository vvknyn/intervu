/**
 * Account side of the résumé copy a role keeps when it's marked Applied
 * (`AppliedResume`; the decisions are in `./resume-on-apply.ts`). `uid` is
 * supplied by the caller, same shape as `./resume-version.ts`.
 *
 * Plain module (not "use server"): it imports the Admin SDK directly, so it
 * must only ever be imported from server code.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { getBaseResumeForUser } from "@/lib/resume/base-resume";
import { resumeTextOnFile } from "@/lib/pursuits/resume-on-apply";
import { validate, guestAppliedResumeSchema } from "@/lib/validation";
import type { AppliedResume, Pursuit } from "@/lib/pursuits/types";

/** The account's résumé as the text a role keeps. Null when there's none or
 *  it can't be read: a failed read never blocks the status write it rides on. */
export async function accountResumeText(uid: string): Promise<string | null> {
    try {
        const base = await getBaseResumeForUser(uid);
        if (base.source === "resume_data") return resumeTextOnFile({ resume_data: base.resume_data });
        if (base.source === "resume_text") return resumeTextOnFile({ resume_text: base.resume_text });
        return null;
    } catch (error) {
        console.error("Error reading the résumé to copy onto an applied role:", error);
        return null;
    }
}

async function ownPursuit(uid: string, pursuitId: string) {
    const ref = getAdminDb().collection("applications").doc(pursuitId);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.user_id !== uid) return null;
    return { ref, pursuit: doc.data() as Pursuit };
}

/** The copy with its text, for Download (the tracker list leaves the text out). */
export async function readAppliedResume(uid: string, pursuitId: string): Promise<{ data?: AppliedResume; error?: string }> {
    const own = await ownPursuit(uid, pursuitId);
    if (!own) return { error: "Pursuit not found" };
    const copy = own.pursuit.applied_resume;
    if (!copy?.content) return { error: "No résumé on this role" };
    return { data: { saved_at: copy.saved_at, content: copy.content } };
}

export async function removeAppliedResume(uid: string, pursuitId: string): Promise<{ error?: string }> {
    const own = await ownPursuit(uid, pursuitId);
    if (!own) return { error: "Pursuit not found" };
    await own.ref.update({ applied_resume: FieldValue.delete(), updated_at: new Date().toISOString() });
    return {};
}

/**
 * Sign-in carries a guest's copy onto the account's role
 * (`syncGuestPursuitsToServer`), with the date it was taken. A role the
 * account already has a résumé on keeps that one.
 */
export async function keepGuestAppliedResume(uid: string, pursuitId: string, input: unknown): Promise<{ error?: string }> {
    const parsed = validate(guestAppliedResumeSchema, input);
    if (!parsed.ok) return { error: parsed.error };
    const own = await ownPursuit(uid, pursuitId);
    if (!own) return { error: "Pursuit not found" };
    if (own.pursuit.applied_resume || own.pursuit.resume_versions?.length) return {};
    await own.ref.update({ applied_resume: { saved_at: parsed.data.saved_at, content: parsed.data.content } });
    return {};
}

/** Firestore allows at most 500 writes in one commit. */
const FIRESTORE_BATCH_LIMIT = 500;

/** Deleting the résumé deletes the copies roles kept of it (Settings "delete résumé"). */
export async function removeAppliedResumesForUser(uid: string): Promise<void> {
    const db = getAdminDb();
    const snap = await db.collection("applications").where("user_id", "==", uid).get();
    const withCopy = snap.docs.filter((doc) => doc.data().applied_resume);
    for (let i = 0; i < withCopy.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = db.batch();
        for (const doc of withCopy.slice(i, i + FIRESTORE_BATCH_LIMIT)) batch.update(doc.ref, { applied_resume: FieldValue.delete() });
        await batch.commit();
    }
}

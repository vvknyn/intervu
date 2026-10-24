"use server";

import { getBaseResumeSummaryForUser, type BaseResume } from "@/lib/resume/base-resume";
import { setBaseResumeForUser, clearBaseResumeForUser, validateResumeUploadText, type SetBaseResumeResult } from "@/lib/resume/set-resume";
import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { syncPreferencesFromResume } from "@/lib/agent/resume-preferences";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { refuseUnpaid, whenPaid } from "@/lib/resume/when-paid";
import type { PAYMENT_REQUIRED } from "@/lib/billing/access";

export type ResumeSummary = BaseResume & { updatedAt: string | null };

// Same "no direct unit test" boundary as agent-preferences.ts's actions —
// `getServerUser()` throws outside a real request scope, so the
// unauthenticated branch isn't exercisable in a plain unit test. The
// canonicalization logic this delegates to is covered by
// tests/unit/resume-base-resume.test.ts.
export async function fetchResumeSummaryAction(): Promise<{ data?: ResumeSummary; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    return { data: await getBaseResumeSummaryForUser(user.uid) };
}

/**
 * Upload/Replace for the account "Resume" section (R1, 2026-08-09 user
 * report). Reuses `setBaseResumeForUser`/`planResumeUpload` (lib/resume/
 * set-resume.ts) — the SAME write seam the MCP `set_resume` tool uses — so
 * a web upload and a chat-filed résumé go through one planner, never a
 * second divergent write path. That module NEVER calls an LLM by
 * construction (see its own doc comment) — the binding no-AI-on-this-path
 * rule holds for free by reuse, not by a separate guard here.
 */
export async function uploadBaseResumeAction(input: { text: string; label?: string }): Promise<{ data?: SetBaseResumeResult; error?: string; code?: typeof PAYMENT_REQUIRED }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const refused = await refuseUnpaid(user.uid);
    if (refused) return refused;
    const validation = validateResumeUploadText(input.text);
    if (!validation.ok) return { error: validation.error };
    const previous = await getAdminDb()
        .collection("profiles")
        .doc(user.uid)
        .get()
        .then((doc) => (doc.data()?.resume_data ?? null) as ResumeData | null)
        .catch(() => null);
    const data = await setBaseResumeForUser(user.uid, { text: validation.text, label: input.label });
    // A replaced résumé replaces what the old one filled in the preferences, as an upload on /jobs does.
    try {
        await syncPreferencesFromResume(user.uid, resumeDataFromPlainText(validation.text) as ResumeData, previous);
    } catch (e: unknown) {
        console.warn("[Resume] Preference sync from résumé failed:", e instanceof Error ? e.message : e);
    }
    return { data };
}

/** Delete for the account "Resume" section — clears the current résumé
 *  and every `resume_history` document, via `clearBaseResumeForUser`. */
export async function deleteBaseResumeAction(): Promise<{ error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    await clearBaseResumeForUser(user.uid);
    return {};
}

import { deleteResumeVersionForUser, getResumeHistoryForUser, saveNamedResumeVersion, type SavedResumeVersion } from "@/lib/resume/set-resume";
import type { ResumeData } from "@/types/resume";

export async function fetchResumeVersionsAction(): Promise<{ data?: SavedResumeVersion[]; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    try {
        return { data: await whenPaid(user.uid, () => getResumeHistoryForUser(user.uid), []) };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to load versions" };
    }
}

export async function deleteResumeVersionAction(versionId: string): Promise<{ error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    try {
        await deleteResumeVersionForUser(user.uid, versionId);
        return {};
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to delete version" };
    }
}

export async function saveNamedResumeVersionAction(input: { data: ResumeData; label: string }): Promise<{ data?: SavedResumeVersion; error?: string; code?: typeof PAYMENT_REQUIRED }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const refused = await refuseUnpaid(user.uid);
    if (refused) return refused;
    try {
        return { data: await saveNamedResumeVersion(user.uid, input) };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to save version" };
    }
}


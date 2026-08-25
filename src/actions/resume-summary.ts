"use server";

import { getBaseResumeSummaryForUser, type BaseResume } from "@/lib/resume/base-resume";
import { setBaseResumeForUser, clearBaseResumeForUser, validateResumeUploadText, type SetBaseResumeResult } from "@/lib/resume/set-resume";
import { getServerUser } from "@/lib/auth/server-user";

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
export async function uploadBaseResumeAction(input: { text: string; label?: string }): Promise<{ data?: SetBaseResumeResult; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const validation = validateResumeUploadText(input.text);
    if (!validation.ok) return { error: validation.error };
    return { data: await setBaseResumeForUser(user.uid, { text: validation.text, label: input.label }) };
}

/** Delete for the account "Resume" section — clears the CURRENT résumé
 *  only; `resume_history` (every prior upload) stays on file, same as
 *  `clearBaseResumeForUser`'s own doc explains. */
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
        return { data: await getResumeHistoryForUser(user.uid) };
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

export async function saveNamedResumeVersionAction(input: { data: ResumeData; label: string }): Promise<{ data?: SavedResumeVersion; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    try {
        return { data: await saveNamedResumeVersion(user.uid, input) };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to save version" };
    }
}


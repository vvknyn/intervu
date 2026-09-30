"use client";

import { useEffect } from "react";
import { hasUsableResumeOnFile, saveResumeData } from "@/actions/resume";
import { captureEvent } from "@/lib/analytics/events";
import { clearLocalAiResume, readLocalAiResume } from "@/lib/local-ai/resume-storage";
import { resumeIsUsable } from "@/lib/resume/resume-usable";

/**
 * Moves a résumé a visitor parsed as a guest into their account once they
 * sign in, when the account has no résumé yet; it never overwrites a saved
 * one. Same rule and write as JobsContent's adoption effect, for surfaces
 * other than /jobs (a guest who uploads on /resume and then signs up used
 * to land on "No resume on file"). Calls `onAdopted` after the write lands
 * and the browser copy is cleared.
 *
 * It lives here, not in src/lib/resume, because nothing in the résumé-parse
 * folders may import a server action (tests/unit/local-ai-no-cloud-imports);
 * this hook only saves a résumé the browser already parsed.
 */
export function useAdoptGuestResume(uid: string | null, surface: string, onAdopted: () => void): void {
    useEffect(() => {
        if (!uid) return;
        const stored = readLocalAiResume();
        if (!stored || !resumeIsUsable(stored.data)) return;
        let cancelled = false;
        void hasUsableResumeOnFile()
            .then(async ({ hasResume }) => {
                if (cancelled || hasResume) return;
                const res = await saveResumeData(stored.data, "pdf", 1);
                if (cancelled || res.error) return;
                clearLocalAiResume();
                captureEvent("resume_uploaded", { surface });
                onAdopted();
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
        // `onAdopted` is a callback prop; re-running on its identity would
        // re-check the server on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid, surface]);
}

"use client";

import { useEffect } from "react";
import { sendIfPaid } from "@/lib/account/paid-status";
import { hasUsableResumeOnFile, saveResumeData } from "@/actions/resume";
import { reloadAgentPreferences } from "@/hooks/use-agent-preferences";
import { captureEvent } from "@/lib/analytics/events";
import { clearLocalAiResume, readLocalAiResume } from "@/lib/local-ai/resume-storage";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { shouldAdoptGuestResume } from "@/lib/resume/adopt-guest-resume";

/**
 * Moves a résumé a visitor parsed as a guest into their account once they
 * sign in, when the account has no résumé yet or an older one
 * (`shouldAdoptGuestResume`): the newer résumé wins. Same rule and write as JobsContent's adoption effect, for surfaces
 * other than /jobs (a guest who uploads on /resume and then signs up used
 * to land on "No resume on file"). Calls `onAdopted` after the write lands
 * and the browser copy is cleared.
 *
 * It lives here, not in src/lib/resume, because nothing in the résumé-parse
 * folders may import a server action (tests/unit/local-ai-no-cloud-imports);
 * this hook only saves a résumé the browser already parsed.
 */
export function useAdoptGuestResume(
    uid: string | null,
    surface: string,
    onAdopted: (adopted: NonNullable<ReturnType<typeof readLocalAiResume>>) => void,
): void {
    useEffect(() => {
        if (!uid) return;
        const stored = readLocalAiResume();
        if (!stored || !resumeIsUsable(stored.data)) return;
        let cancelled = false;
        void hasUsableResumeOnFile()
            .then(async ({ hasResume, updatedAt, paywalled }) => {
                // Saving to the account is the paid month: the copy stays on this device, with no write to retry on every visit.
                if (cancelled || paywalled) return;
                if (!shouldAdoptGuestResume({ serverHasResume: hasResume, serverUpdatedAt: updatedAt, localUpdatedAt: stored.updatedAt })) {
                    // The account's copy is newer: this browser's is stale, so it can't stand in for it later.
                    if (hasResume) clearLocalAiResume();
                    return;
                }
                const res = await sendIfPaid(() => saveResumeData(stored.data, "pdf", 1));
                if (cancelled || res.error) return;
                clearLocalAiResume();
                void reloadAgentPreferences(uid);
                captureEvent("resume_uploaded", { surface });
                onAdopted(stored);
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

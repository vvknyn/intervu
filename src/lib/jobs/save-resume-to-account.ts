import { saveResumeData } from "@/actions/resume";
import { reloadAgentPreferences } from "@/hooks/use-agent-preferences";
import { keepExplicitNudges } from "@/lib/jobs/for-you/tuning-store";
import { toast } from "@/lib/toast";
import type { ResumeData } from "@/types/resume";

/** What a signed-in person reads when their résumé didn't reach their account. */
const RESUME_NOT_SAVED_MESSAGE = "Your résumé didn't save to your account, so it's only in this browser for now.";

/**
 * Saves a résumé to the signed-in person's account, and says so when it
 * can't. A failed save used to look saved until the next visit, when the
 * résumé was gone (journey audit). The message stays until they close it, and
 * its Try again sends the same résumé again. Shared by every page that takes
 * an upload (/jobs, the company page), so a failed save reads the same on each.
 */
export function saveResumeToAccount(
    data: ResumeData,
    source: "pdf" | "docx" | "text",
    confidence: number,
    handlers: { onSaved?: () => void; onFailed?: () => void; uid?: string | null } = {},
    retry = false,
): void {
    // Every upload path ends here: what the old résumé tuned goes now, so the next pack is the new one's.
    keepExplicitNudges();
    void saveResumeData(data, source, confidence)
        .catch((): { error?: string } => ({ error: "network" }))
        .then((res) => {
            if (!res.error) {
                if (retry) toast.success("Résumé saved to your account.");
                // The save rewrote the preferences the old résumé filled; read them again.
                if (handlers.uid) void reloadAgentPreferences(handlers.uid);
                handlers.onSaved?.();
                return;
            }
            handlers.onFailed?.();
            toast.error(RESUME_NOT_SAVED_MESSAGE, 0, {
                label: "Try again",
                onClick: () => saveResumeToAccount(data, source, confidence, handlers, true),
            });
        });
}

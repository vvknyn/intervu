import { saveResumeData } from "@/actions/resume";
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
    handlers: { onSaved?: () => void; onFailed?: () => void } = {},
    retry = false,
): void {
    void saveResumeData(data, source, confidence)
        .catch((): { error?: string } => ({ error: "network" }))
        .then((res) => {
            if (!res.error) {
                if (retry) toast.success("Résumé saved to your account.");
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

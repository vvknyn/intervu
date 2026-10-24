import type { fetchResumeData } from "@/actions/resume";
import type { fetchAgentPreferencesAction } from "@/actions/agent-preferences";

type StoredResume = Awaited<ReturnType<typeof fetchResumeData>>;
type Preferences = Awaited<ReturnType<typeof fetchAgentPreferencesAction>>;

/**
 * What `/api/extension/me` tells a signed-in extension. `paid` says whether the
 * account has a paid month; without one `resume` is null (the stored résumé is
 * the paid part: `fetchResumeData` reads none), so the panel shows its
 * no-résumé state. Tracking and preferences stay free. A failed résumé read
 * (which includes the paid-access check) answers 503 and never `paid: true`.
 */
export function extensionMeBody(resume: StoredResume, prefs: Preferences) {
    if (resume.error) return { status: 503, body: { signedIn: true as const, error: "unavailable" } };
    return {
        status: 200,
        body: {
            signedIn: true as const,
            paid: resume.paywalled !== true,
            resume: resume.paywalled ? null : { data: resume.data ?? null, text: resume.text ?? null, updatedAt: resume.updatedAt ?? null },
            preferences: prefs.data ?? null,
        },
    };
}

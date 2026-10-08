import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { fetchResumeData } from "@/actions/resume";
import { fetchAgentPreferencesAction } from "@/actions/agent-preferences";

/**
 * GET /api/extension/me — what the Velai Chrome extension needs to show a
 * signed-in person their fit for the job they're looking at: the saved
 * résumé (as stored: structured data, or the text the browser structures —
 * résumé parsing never runs on our servers) and the saved preferences every
 * fit label on velai.app is scored with.
 *
 * Read through the person's own velai.app session cookie. The extension's
 * host permission for velai.app is what lets it send that cookie; ordinary
 * cross-site pages can't read this response (no CORS headers are set).
 * Signed out answers `{ signedIn: false }`, not an error, so the panel can
 * offer sign-in.
 */
export async function GET(): Promise<NextResponse> {
    const headers = { "Cache-Control": "no-store, private" };
    const user = await getServerUser();
    if (!user) return NextResponse.json({ signedIn: false }, { headers });

    const [resume, prefs] = await Promise.all([fetchResumeData(), fetchAgentPreferencesAction()]);
    return NextResponse.json(
        {
            signedIn: true,
            resume: resume.error ? null : { data: resume.data ?? null, text: resume.text ?? null, updatedAt: resume.updatedAt ?? null },
            preferences: prefs.data ?? null,
        },
        { headers },
    );
}

import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { fetchResumeData } from "@/actions/resume";
import { fetchAgentPreferencesAction } from "@/actions/agent-preferences";
import { extensionMeBody } from "@/lib/extension-me";

/**
 * GET /api/extension/me — what the Velai Chrome extension needs to show a
 * signed-in person their fit for the job they're looking at: the saved
 * résumé (as stored: structured data, or the text the browser structures —
 * résumé parsing never runs on our servers; only with a paid month, else
 * `resume: null` and `paid: false`) and the saved preferences every
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
    const { status, body } = extensionMeBody(resume, prefs);
    return NextResponse.json(body, { status, headers });
}

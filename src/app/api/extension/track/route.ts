import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { markJobAppliedAction, markJobSavedAction } from "@/actions/jobs";

/** A tracker entry is a title, an employer, a URL and an id: far past this isn't one. */
const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/extension/track — the Velai Chrome extension's "I applied" and
 * "Save": adds the job the person is looking at to their Velai tracker as
 * Applied (the default, through the same `markJobAppliedAction` velai.app's own
 * "Mark as applied" uses) or, with `"stage": "saved"`, as Saved without
 * applying (`markJobSavedAction`, the stage "Go after this job" and the MCP
 * `save_job` write). Both carry Velai's job id when Velai has the posting, so
 * the role lands on that job; a save answers with the role's `status`, which a
 * role further along keeps.
 *
 * Read through the person's own velai.app session cookie, which the
 * extension's host permission lets it send. Only a JSON body is accepted: a
 * cross-site page can't send one without a CORS preflight, which this route
 * never answers, so no other site can add to someone's tracker.
 */
export async function POST(request: Request): Promise<NextResponse> {
    const headers = { "Cache-Control": "no-store, private" };
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 415, headers });
    }
    const user = await getServerUser();
    if (!user) return NextResponse.json({ ok: false, error: "Signed out" }, { status: 401, headers });

    const raw = await request.text();
    let body: Record<string, unknown> | null = null;
    try {
        const parsed: unknown = raw.length <= MAX_BODY_BYTES ? JSON.parse(raw) : null;
        body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        body = null;
    }
    if (!body) return NextResponse.json({ ok: false, error: "Not a job" }, { status: 400, headers });

    const field = (key: string) => (typeof body[key] === "string" ? body[key] : "");
    const jobId = field("jobId");
    const job = {
        title: field("title"),
        company: field("company"),
        applyUrl: field("applyUrl"),
        ...(jobId ? { jobId } : {}),
    };
    if (body.stage === "saved") {
        const saved = await markJobSavedAction(job);
        if (saved.error) return NextResponse.json({ ok: false, error: saved.error }, { status: 400, headers });
        return NextResponse.json({ ok: true, id: saved.data?.id ?? null, status: saved.data?.status ?? "interested" }, { headers });
    }
    const res = await markJobAppliedAction(job);
    if (res.error) return NextResponse.json({ ok: false, error: res.error }, { status: 400, headers });
    return NextResponse.json({ ok: true, id: res.data?.id ?? null }, { headers });
}

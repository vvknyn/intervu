/**
 * The introduction itself. Both devices POST their connection details here
 * and GET the other side's. A few KB per session, then the two talk directly
 * and this endpoint is never called again — which is why no frame of the
 * user's screen ever reaches us.
 *
 * The laptop authenticates with its bearer credential, the phone with its
 * normal intervu login. Either way `authorizeSession` decides, so both doors
 * apply one rule.
 */
import { NextResponse } from "next/server";
import { extractBearerToken } from "@/lib/agent/http";
import { verifySecret, AUTHORIZED_CREDENTIAL_KINDS } from "@/lib/agent/tokens";
import { firestoreStore } from "@/lib/agent/store";
import { getServerUser } from "@/lib/firebase/auth-session";
import { authorizeSession, type SignalBlob, type ViewerSession } from "@/lib/viewer/sessions";
import { getSession, putSignal, deleteSession } from "@/lib/viewer/session-store";

async function callerUid(request: Request): Promise<string | null> {
    const secret = extractBearerToken(request);
    if (secret) {
        const credential = await verifySecret(firestoreStore(), secret);
        return credential && AUTHORIZED_CREDENTIAL_KINDS.has(credential.kind) ? credential.uid : null;
    }
    return (await getServerUser())?.uid ?? null;
}

type Admitted = { session: ViewerSession; denied?: never };
type Denied = { session?: never; denied: NextResponse };

async function admit(request: Request, id: string): Promise<Admitted | Denied> {
    const [uid, session] = await Promise.all([callerUid(request), getSession(id)]);
    const verdict = authorizeSession(session, uid);
    if (!verdict.ok) {
        return { denied: NextResponse.json({ error: verdict.error }, { status: verdict.status }) };
    }
    return { session: verdict.session };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { session, denied } = await admit(request, id);
    if (denied) return denied;
    return NextResponse.json({ host: session.host, guest: session.guest });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { denied } = await admit(request, id);
    if (denied) return denied;

    const body = (await request.json()) as { role?: string; sdp?: string; answeredOffer?: string };
    if (body.role !== "host" && body.role !== "guest") {
        return NextResponse.json({ error: "role must be host or guest" }, { status: 400 });
    }
    if (typeof body.sdp !== "string" || !body.sdp) {
        return NextResponse.json({ error: "sdp (string) is required" }, { status: 400 });
    }
    const blob: SignalBlob = { sdp: body.sdp };
    if (typeof body.answeredOffer === "string") blob.answeredOffer = body.answeredOffer;
    await putSignal(id, body.role, blob);
    return NextResponse.json({ ok: true });
}

/**
 * Called by the viewer at handoff. The spec requires a session to die when
 * the application is handed over rather than linger until its TTL, so this is
 * not tidy-up — it is the security boundary closing.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { denied } = await admit(request, id);
    if (denied) return denied;
    await deleteSession(id);
    return NextResponse.json({ ok: true });
}

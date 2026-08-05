/**
 * POST /api/viewer/session — the laptop rings the doorbell.
 *
 * Authenticated with the same bearer credential the agent already holds, so
 * the user grants nothing new and the installer gains no step. Returns the
 * URL to open on the phone.
 *
 * Only the laptop creates sessions, so this accepts a bearer credential and
 * not a browser cookie. The phone never reaches here — it arrives at
 * /watch/<id> with a link it was handed.
 */
import { NextResponse } from "next/server";
import { extractBearerToken } from "@/lib/agent/http";
import { verifySecret, AUTHORIZED_CREDENTIAL_KINDS } from "@/lib/agent/tokens";
import { firestoreStore } from "@/lib/agent/store";
import { createSession } from "@/lib/viewer/session-store";

export async function POST(request: Request) {
    const secret = extractBearerToken(request);
    if (!secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const credential = await verifySecret(firestoreStore(), secret);
    if (!credential || !AUTHORIZED_CREDENTIAL_KINDS.has(credential.kind)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const session = await createSession(credential.uid);
    const origin = new URL(request.url).origin;
    return NextResponse.json({
        sessionId: session.id,
        watchUrl: `${origin}/watch/${session.id}`,
        expiresAt: session.expiresAt,
    });
}

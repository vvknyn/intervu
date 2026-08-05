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

    // No watch URL here on purpose. Building one needs the origin the phone
    // should dial, and this handler cannot know it: `new URL(request.url)`
    // reported the dev server's bind address (0.0.0.0) rather than the host
    // actually called, and behind Caddy it would report the container's. The
    // caller dialled a specific origin, so the caller composes the link.
    const session = await createSession(credential.uid);
    return NextResponse.json({ sessionId: session.id, expiresAt: session.expiresAt });
}

import { NextResponse, after } from "next/server";
import { createSessionCookie, setSessionCookie, clearSessionCookie } from "@/lib/firebase/auth-session";
import { getAdminAuth } from "@/lib/firebase/admin";
import { sendWelcomeEmailOnce } from "@/lib/email/welcome";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowAuthSessionRequest } from "@/lib/shield/rate-limit";

/**
 * POST /api/auth/session — Create session cookie from ID token
 *
 * Also the welcome email's trigger, because it is the ONLY server-side point
 * every provider shares: password signup runs through `signUp`
 * (actions/auth.ts), but Google sign-in is entirely client-side
 * (`signInWithPopup`, lib/firebase/client-auth.ts) and touches the server
 * for the first time right here. Hanging the welcome off `signUp` would have
 * silently excluded every Google account — the exact users whose address is
 * real (see `isMintedLoginEmail`).
 *
 * Runs in `after()`, so it executes once the response is already on its way:
 * a person signing in never waits on Resend, and a slow or failing send can
 * never turn a successful sign-in into an error. `sendWelcomeEmailOnce`
 * additionally never throws, since a rejection here would be unhandled — the
 * request it belonged to is finished.
 */
export async function POST(request: Request) {
    const ip = await getClientIp();
    if (!allowAuthSessionRequest(ip)) {
        return NextResponse.json({ error: "Too many attempts — try again in a few minutes." }, { status: 429 });
    }

    try {
        const { idToken } = await request.json();

        if (!idToken) {
            return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
        }

        const sessionCookie = await createSessionCookie(idToken);
        await setSessionCookie(sessionCookie);

        // Verified against the ID TOKEN rather than read from the request
        // body: the uid and email this decides on have to be ones Firebase
        // vouches for, not ones a caller supplied. `createSessionCookie`
        // above has already proven the token is valid, so this cannot admit
        // an unauthenticated send.
        after(async () => {
            const decoded = await getAdminAuth()
                .verifyIdToken(idToken)
                .catch((err) => {
                    console.error("[Session] welcome-email token decode failed:", err);
                    return null;
                });
            if (decoded) await sendWelcomeEmailOnce(decoded.uid, decoded.email);
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("[Session] Create error:", error);
        return NextResponse.json({ error: error.message || "Failed to create session" }, { status: 401 });
    }
}

/**
 * DELETE /api/auth/session — Clear session cookie
 */
export async function DELETE() {
    try {
        await clearSessionCookie();
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("[Session] Delete error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

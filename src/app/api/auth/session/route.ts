import { NextResponse } from "next/server";
import { createSessionCookie, setSessionCookie, clearSessionCookie } from "@/lib/firebase/auth-session";

/**
 * POST /api/auth/session — Create session cookie from ID token
 */
export async function POST(request: Request) {
    try {
        const { idToken } = await request.json();

        if (!idToken) {
            return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
        }

        const sessionCookie = await createSessionCookie(idToken);
        await setSessionCookie(sessionCookie);

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

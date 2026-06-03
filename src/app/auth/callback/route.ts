import { NextResponse } from "next/server";

/**
 * Auth callback route — no longer needed for Firebase.
 * Firebase Auth handles redirects client-side.
 * Keeping this route to avoid 404s from old links.
 */
export async function GET(request: Request) {
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/`);
}

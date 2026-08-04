import { NextResponse, type NextRequest } from "next/server";
import { shouldBlockSuspiciousRequest } from "@/lib/shield/suspicious-request";
import { JOBS_VISITOR_COOKIE, JOBS_VISITOR_COOKIE_MAX_AGE } from "@/lib/jobs-visitor-cookie";

const SESSION_COOKIE_NAME = "firebase-session";

export async function middleware(request: NextRequest) {
    // P27 shield — block only the one obvious bulk signature: an
    // empty/absent User-Agent on a non-GET request under /api/. See
    // lib/shield/suspicious-request.ts for why this stays this narrow.
    if (
        shouldBlockSuspiciousRequest({
            pathname: request.nextUrl.pathname,
            method: request.method,
            userAgent: request.headers.get("user-agent"),
        })
    ) {
        return new NextResponse(null, { status: 403 });
    }

    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    // Protect /account routes — redirect to landing page if not authenticated
    if (
        !sessionCookie &&
        request.nextUrl.pathname.startsWith("/account")
    ) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
    }

    const response = NextResponse.next();

    // Returning-searcher memory (see lib/jobs-visitor-cookie.ts) — client-
    // readable, not httpOnly, since it's only ever a "have you been here
    // before" flag for `/`'s bar, never an auth artifact.
    if (request.nextUrl.pathname.startsWith("/jobs")) {
        response.cookies.set(JOBS_VISITOR_COOKIE, "1", {
            maxAge: JOBS_VISITOR_COOKIE_MAX_AGE,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            sameSite: "lax",
        });
    }

    return response;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};

import { NextResponse, type NextRequest } from "next/server";
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { isAuthSignOutRequest } from "@/lib/auth/signout-request";
import { isAuthGatedProductPath, loginRedirectUrl } from "@/lib/auth/product-routes";
import { shouldBlockSuspiciousRequest } from "@/lib/shield/suspicious-request";
import { JOBS_QUERY_HEADER } from "@/lib/seo/jobs-query-header";
import {
    JOBS_VISITOR_COOKIE,
    JOBS_VISITOR_COOKIE_MAX_AGE,
    shouldStampJobsVisitor,
} from "@/lib/jobs-visitor-cookie";

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

    const { pathname } = request.nextUrl;
    const jobsHasQuery =
        pathname === "/jobs" && request.nextUrl.searchParams.toString().length > 0;
    if (jobsHasQuery) {
        request.headers.set(JOBS_QUERY_HEADER, "1");
    }

    // Sign-out POST must not refresh wos-session — authkit() would re-seal the
    // cookie after AuthKit deletes it, or race the delete on the way out.
    if (isAuthSignOutRequest(pathname, request.method)) {
        return NextResponse.next();
    }

    // WorkOS AuthKit session — composable pattern that integrates with
    // existing middleware logic rather than replacing it entirely.
    const { session, headers } = await authkit(request);

    // Protected routes: bounce to OUR branded /login with a `next=` return
    // param. The WorkOS hosted chooser (skillful-spoon-89.authkit.app) is
    // reached only mid-flow, from /login itself, for the passkey/email-code
    // steps that genuinely need it — never as the first hop for a logged-out
    // visitor hitting a gated product route.
    if (!session.user && isAuthGatedProductPath(pathname)) {
        return handleAuthkitHeaders(request, headers, {
            redirect: loginRedirectUrl(request.nextUrl, pathname),
        });
    }

    // Returning-searcher memory (see lib/jobs-visitor-cookie.ts) — client-
    // readable, not httpOnly, since it's only ever a "have you been here
    // before" flag for `/`'s bar, never an auth artifact.
    const response = handleAuthkitHeaders(request, headers);

    if (shouldStampJobsVisitor({ method: request.method, pathname })) {
        response.cookies.set(JOBS_VISITOR_COOKIE, "1", {
            maxAge: JOBS_VISITOR_COOKIE_MAX_AGE,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            sameSite: "lax",
        });
    }

    // Google/Search Engine Disallow: unconditionally instruct all search engines
    // to ignore and drop any individual job pages, ?job= permalinks, or parameterized job queries.
    const isJobRoute =
        pathname.startsWith("/jobs/") ||
        pathname.startsWith("/job/") ||
        request.nextUrl.searchParams.has("job") ||
        (pathname === "/jobs" && request.nextUrl.searchParams.toString().length > 0) ||
        (pathname === "/" && request.nextUrl.searchParams.toString().length > 0);

    if (isJobRoute) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    }

    return response;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};

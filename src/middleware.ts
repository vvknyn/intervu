import { NextResponse, type NextRequest } from "next/server";
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { isAuthGatedProductPath } from "@/lib/auth/product-routes";
import { shouldBlockSuspiciousRequest } from "@/lib/shield/suspicious-request";
import { allowDetailPageRequest, DETAIL_PAGE_WINDOW_MS, isDetailPagePath } from "@/lib/shield/rate-limit";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";
import { JOBS_VISITOR_COOKIE, JOBS_VISITOR_COOKIE_MAX_AGE } from "@/lib/jobs-visitor-cookie";

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

    // Per-IP rate limit on the /jobs/<slug> and /co/<slug> detail pages
    // (lib/shield/rate-limit.ts's `isDetailPagePath`/`allowDetailPageRequest`
    // docblocks for scope + sizing). Cheapest possible rejection: before the
    // WorkOS `authkit()` call below, which does real work on every request.
    if (isDetailPagePath(request.nextUrl.pathname)) {
        const ip = resolveClientIpFromHeaders(request.headers);
        if (!allowDetailPageRequest(ip)) {
            return new NextResponse(null, {
                status: 429,
                headers: { "Retry-After": String(DETAIL_PAGE_WINDOW_MS / 1000) },
            });
        }
    }

    // WorkOS AuthKit session — composable pattern that integrates with
    // existing middleware logic rather than replacing it entirely.
    const { session, headers, authorizationUrl } = await authkit(request);
    const { pathname } = request.nextUrl;

    // Protected routes: redirect to WorkOS auth if not authenticated
    if (!session.user && isAuthGatedProductPath(pathname)) {
        if (authorizationUrl) {
            return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
        }
        // Fallback if no auth URL (shouldn't happen, but be safe)
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
        return NextResponse.redirect(url);
    }

    // Returning-searcher memory (see lib/jobs-visitor-cookie.ts) — client-
    // readable, not httpOnly, since it's only ever a "have you been here
    // before" flag for `/`'s bar, never an auth artifact.
    const response = handleAuthkitHeaders(request, headers);

    if (pathname.startsWith("/jobs")) {
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

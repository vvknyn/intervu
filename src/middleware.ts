import { NextResponse, userAgent, type NextRequest } from "next/server";
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { isAuthSignOutRequest } from "@/lib/auth/signout-request";
import { isAuthGatedProductPath, loginRedirectUrl } from "@/lib/auth/product-routes";
import { shouldBlockSuspiciousRequest } from "@/lib/shield/suspicious-request";
import { JOBS_QUERY_HEADER } from "@/lib/seo/jobs-query-header";
import { FIRST_ROWS_PATH, shouldServeFirstRows } from "@/lib/jobs/server-first-rows";
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

    // A signed-out phone opening a search link gets the list's first rows in
    // the page itself (lib/jobs/server-first-rows.ts): rewritten to the
    // dynamic copy of /jobs, the address bar unchanged.
    const isFirstRowsPath = pathname === FIRST_ROWS_PATH;
    const firstRows = shouldServeFirstRows({
        method: request.method,
        pathname: isFirstRowsPath ? "/jobs" : pathname,
        searchParams: request.nextUrl.searchParams,
        headers: request.headers,
        signedIn: !!session.user,
        isBot: userAgent(request).isBot,
    });
    if (isFirstRowsPath) {
        // Normally the rewrite below is routed inside this server and never
        // comes back through here. When the server's own address differs
        // from the one Next.js writes the rewrite with (bound to 127.0.0.1,
        // rewritten as localhost), Next.js proxies it to that URL instead,
        // and it arrives here as a new request: serve it. Anyone the rewrite
        // wouldn't pick is sent to the page this one stands in for, which
        // never rewrites back, so the two can't loop.
        return firstRows ? response : handleAuthkitHeaders(request, headers, { redirect: jobsUrl(request), redirectStatus: 308 });
    }
    return firstRows ? asRewrite(response, request, FIRST_ROWS_PATH) : response;
}

function jobsUrl(request: NextRequest): URL {
    const url = request.nextUrl.clone();
    url.pathname = "/jobs";
    return url;
}

/**
 * The same response routed to `pathname` instead: AuthKit's forwarded
 * request headers, its cookies (minus the unused sign-in verifier it drops)
 * and the headers set above all carry over. A `NextResponse.next()` and a
 * `NextResponse.rewrite()` differ only in the header that routes them.
 */
function asRewrite(response: NextResponse, request: NextRequest, pathname: string): NextResponse {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const rewrite = NextResponse.rewrite(url, { headers: response.headers });
    rewrite.headers.delete("x-middleware-next");
    return rewrite;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};

import { NextResponse } from "next/server";

/**
 * Route-handler redirects behind our reverse proxy must be relative. Inside
 * the Next standalone container, `request.url`'s origin is the container's
 * own bind address (e.g. `http://0.0.0.0:3000`), not the public host Caddy
 * terminated the request on — so any `NextResponse.redirect(new URL(path,
 * request.url))` bakes that bind address into an absolute Location header
 * and strands the browser there. A bare relative Location has no origin to
 * get wrong: the browser resolves it against the real address bar itself.
 *
 * `status` defaults to 307 (the same default `NextResponse.redirect` uses)
 * so GET-triggered redirects stay GET; pass 302/303 explicitly for a
 * POST-handler redirect that must let the browser downgrade the replay to
 * GET, same as the call it's replacing did.
 */
export function relativeRedirect(path: string, status = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`relativeRedirect requires an app-relative path, got: ${path}`);
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}

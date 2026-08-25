import { handleAuth } from "@workos-inc/authkit-nextjs";
import { getSiteUrl } from "@/lib/seo/constants";

/**
 * WorkOS AuthKit OAuth callback route.
 * Exchanges the authorization code for a session and sets cookies.
 *
 * `baseURL` is not optional here, whatever the library's default suggests.
 * Without it the post-exchange redirect is built from the inbound request
 * (`authkit-callback-route.ts`: `baseURL ? new URL(baseURL) : new URL(requestUrl)`),
 * and this app is served by Caddy in front of a container that binds `0.0.0.0`
 * — so the browser was sent to `0.0.0.0` immediately after choosing a Google
 * account. Everything upstream looked healthy because the authorization
 * `redirect_uri` comes from an absolute env var; only this last hop read the
 * request's own host.
 *
 * `getSiteUrl()` is the same canonical origin `metadataBase`, the sitemap and
 * robots.txt already use, and it throws when unset rather than guessing a
 * domain — so a missing var fails loudly at startup instead of silently
 * redirecting users somewhere unreachable.
 */
export const GET = handleAuth({ baseURL: getSiteUrl() });

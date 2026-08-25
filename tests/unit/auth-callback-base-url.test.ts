import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What this protects: every absolute URL the auth routes hand back to a browser
 * must come from the site's canonical origin, never from the inbound request.
 *
 * This app runs in a container that binds `0.0.0.0` behind Caddy, so the
 * request's own host is an address no browser can reach. `handleAuth()` builds
 * its post-exchange redirect from `request.nextUrl` unless a `baseURL` is
 * supplied — which sent users to `0.0.0.0` the moment they picked a Google
 * account. Everything before that hop looked correct, because the authorization
 * `redirect_uri` comes from an absolute env var.
 *
 * These are source assertions rather than behavioural ones on purpose:
 * `@workos-inc/authkit-nextjs` is ESM-only, and importing it here would break
 * the CJS test runner for every file that transitively reaches these routes —
 * the same reason `/auth/start` defers its import.
 */

const AUTH_ROUTES_DIR = join(process.cwd(), "src/app/auth");
const CALLBACK_ROUTE = join(AUTH_ROUTES_DIR, "callback/route.ts");

/**
 * Ways to derive an absolute URL from the inbound request. Each one yields the
 * container's bind address in production, so none belongs in a redirect an auth
 * route hands to a browser.
 */
const REQUEST_DERIVED_ORIGIN = /new URL\(\s*request\.url|nextUrl\.origin|nextUrl\.clone\(\)|headers\(\)\.get\(\s*["'`]host/;

/**
 * Every assertion below reads code, not prose. The first draft of this file
 * asserted on the raw source and passed while the route was reverted, because
 * the doc comment mentions `getSiteUrl()` — a probe matching its own
 * documentation proves nothing.
 */
function codeOf(file: string): string {
    return readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
}

function authRouteFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return authRouteFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
    });
}

describe("auth callback base URL", () => {
    it("passes an explicit baseURL to handleAuth", () => {
        const source = codeOf(CALLBACK_ROUTE);
        assert.match(
            source,
            /handleAuth\(\s*\{[^}]*baseURL/,
            "handleAuth() without baseURL redirects to the container's own host after the code exchange",
        );
    });

    // The origin must be the canonical one the rest of the app already uses.
    // Hardcoding the domain here would pass this assertion and still be wrong:
    // it would drift from metadataBase/sitemap/robots the day the domain moves.
    it("derives that baseURL from the canonical site origin", () => {
        const source = codeOf(CALLBACK_ROUTE);
        assert.match(source, /getSiteUrl\(\)/);
        assert.match(source, /from "@\/lib\/seo\/constants"/);
    });

    /**
     * The class, not the instance. `/auth/callback` is simply where it surfaced;
     * `/auth/start` and `/auth/signout` hand out redirects too, and a fourth
     * route added later would be just as exposed.
     */
    it("keeps every auth route off request-derived origins", () => {
        const offenders = authRouteFiles(AUTH_ROUTES_DIR).filter((file) =>
            REQUEST_DERIVED_ORIGIN.test(codeOf(file)),
        );
        assert.deepEqual(offenders, [], "auth routes must build absolute URLs from getSiteUrl()");
    });

    // The scan above is only worth trusting if it can find something. Without
    // this, a typo'd regex would report a clean sweep forever.
    it("detects a request-derived origin when one is present", () => {
        assert.ok(REQUEST_DERIVED_ORIGIN.test('const url = new URL(request.url);'));
        assert.ok(REQUEST_DERIVED_ORIGIN.test("redirect(request.nextUrl.origin + '/jobs')"));
        assert.ok(!REQUEST_DERIVED_ORIGIN.test("const url = new URL(getSiteUrl());"));
    });

    it("finds the auth routes it claims to be scanning", () => {
        const files = authRouteFiles(AUTH_ROUTES_DIR);
        assert.ok(files.length >= 3, `expected the auth routes, found ${files.length}`);
        assert.ok(files.some((f) => f.endsWith("callback/route.ts")));
    });
});

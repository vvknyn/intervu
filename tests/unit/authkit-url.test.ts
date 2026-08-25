import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { withAuthProvider } from "@/lib/auth/authkit-url";

/**
 * What this protects: `@workos-inc/authkit-nextjs` mints the sealed `state` and
 * the matching PKCE cookie, then hardcodes `provider=authkit` so every sign-in
 * lands on the hosted chooser page. Overriding only that one parameter is what
 * lets "Continue with Google" go straight to Google while the library keeps
 * owning the security material.
 *
 * The property that actually matters is therefore NOT "google works" — it is
 * that nothing else in the URL moves. If `state` or `code_challenge` were
 * altered or dropped, the callback would reject the flow with an OAuth state
 * mismatch, and it would do so only in a real browser round trip.
 */

const AUTHKIT_URL =
    "https://api.workos.com/user_management/authorize" +
    "?client_id=client_test" +
    "&redirect_uri=https%3A%2F%2Fintervuhq.com%2Fauth%2Fcallback" +
    "&response_type=code" +
    "&state=Fe26.2*1*abc*def~2" +
    "&code_challenge=chal123" +
    "&code_challenge_method=S256" +
    "&screen_hint=sign-in" +
    "&login_hint=someone%40example.com" +
    "&provider=authkit";

describe("withAuthProvider", () => {
    it("replaces the library's hardcoded authkit provider", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, "GoogleOAuth"));
        assert.equal(out.searchParams.get("provider"), "GoogleOAuth");
    });

    // Deliberately a provider OTHER than the one this was built for: the helper
    // must be generic over whatever the WorkOS dashboard has enabled, not a
    // Google special case wearing a parameter.
    it("works for any provider, not just Google", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, "MicrosoftOAuth"));
        assert.equal(out.searchParams.get("provider"), "MicrosoftOAuth");
        assert.equal(out.searchParams.getAll("provider").length, 1, "must replace, not append");
    });

    it("adds the provider when the URL carries none", () => {
        const bare = "https://api.workos.com/user_management/authorize?client_id=client_test";
        const out = new URL(withAuthProvider(bare, "GoogleOAuth"));
        assert.equal(out.searchParams.get("provider"), "GoogleOAuth");
    });

    // The security-critical property. A helper that quietly re-encoded or
    // dropped these would still pass every assertion above and fail only in a
    // real browser, as an OAuth state mismatch at the callback.
    it("leaves the sealed state and PKCE challenge byte-identical", () => {
        const before = new URL(AUTHKIT_URL);
        const after = new URL(withAuthProvider(AUTHKIT_URL, "GoogleOAuth"));

        for (const key of ["state", "code_challenge", "code_challenge_method", "redirect_uri", "client_id"]) {
            assert.equal(
                after.searchParams.get(key),
                before.searchParams.get(key),
                `${key} must survive the provider swap unchanged`,
            );
        }
    });

    it("returns the URL untouched when no provider is requested", () => {
        for (const empty of [null, undefined, ""]) {
            assert.equal(withAuthProvider(AUTHKIT_URL, empty), AUTHKIT_URL);
        }
    });

    /**
     * The production failure this was written for. `screen_hint` asks the hosted
     * page for a particular screen; naming a provider means no hosted page ever
     * renders. WorkOS rejects the pair outright — `302 error.workos.com/sso`,
     * shown to the user as "Couldn't sign in" — instead of ignoring the
     * leftover, so leaving it in place breaks every provider hand-off.
     */
    it("drops screen_hint when a provider is named", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, "GoogleOAuth"));
        assert.equal(out.searchParams.get("screen_hint"), null);
    });

    // A different provider AND the other screen_hint value: the sign-up door
    // built the same URL with `screen_hint=sign-up`, so a fix that only handled
    // the sign-in case would have left half the flows broken.
    it("drops screen_hint for any provider and either screen", () => {
        const signup = AUTHKIT_URL.replace("screen_hint=sign-in", "screen_hint=sign-up");
        const out = new URL(withAuthProvider(signup, "MicrosoftOAuth"));
        assert.equal(out.searchParams.get("screen_hint"), null);
        assert.equal(out.searchParams.get("provider"), "MicrosoftOAuth");
    });

    // The other half of the rule, and the reason it is not "strip every hint":
    // WorkOS forwards login_hint upstream, so it stays useful exactly when the
    // hosted page is skipped. A blanket strip would pass the test above and
    // quietly lose the pre-filled account.
    it("keeps hints that describe the user, not the screen", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, "GoogleOAuth"));
        assert.equal(out.searchParams.get("login_hint"), "someone@example.com");
    });

    // Without a provider the hosted page is exactly where the user is going, so
    // the parameter must survive. This is the negative control for the strip.
    it("keeps screen_hint when no provider is requested", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, null));
        assert.equal(out.searchParams.get("screen_hint"), "sign-in");
    });

    it("encodes a provider value rather than letting it inject parameters", () => {
        const out = new URL(withAuthProvider(AUTHKIT_URL, "Evil&redirect_uri=https://attacker.test"));
        assert.equal(out.searchParams.get("redirect_uri"), "https://intervuhq.com/auth/callback");
        assert.equal(out.searchParams.get("provider"), "Evil&redirect_uri=https://attacker.test");
    });
});

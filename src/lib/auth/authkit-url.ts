/**
 * Send an AuthKit authorization URL to a specific upstream provider.
 *
 * `@workos-inc/authkit-nextjs` hardcodes `provider=authkit` when it builds the
 * URL, which always lands the user on the hosted chooser page. The WorkOS
 * authorize endpoint underneath accepts any provider configured for the
 * environment on that same parameter, and the sealed `state` and PKCE cookie
 * the library has just minted are provider-independent — so overriding the
 * value reuses the library's own security material rather than re-deriving it.
 *
 * Re-deriving is the alternative worth naming, because it looks tempting and
 * is not: the callback verifies `state` against a flow-specific PKCE cookie and
 * reads the code verifier out of it, so building an authorization URL by hand
 * means duplicating four unexported internals (state sealing, PKCE generation,
 * the cookie's derived name, and its options) in the single most
 * security-sensitive flow in the app.
 *
 * The provider is deliberately not checked against a local list of known
 * values. WorkOS is the authority on which providers an environment actually
 * has, and it answers an unknown one with an explicit
 * `connection_strategy_invalid` redirect rather than signing anybody in. A
 * local allowlist would need editing every time a provider is enabled in the
 * dashboard, and would silently disagree with the dashboard until someone did.
 */
export function withAuthProvider(url: string, provider: string | null | undefined): string {
    if (!provider) return url;
    const target = new URL(url);
    target.searchParams.set("provider", provider);
    for (const param of HOSTED_PAGE_ONLY_PARAMS) target.searchParams.delete(param);
    return target.toString();
}

/**
 * Parameters that only mean something while AuthKit's hosted page is rendering.
 *
 * Naming a provider skips that page entirely, and WorkOS treats the combination
 * as malformed rather than ignoring the leftover: authorize answers `302
 * https://error.workos.com/sso` and the user sees "Couldn't sign in". The
 * library adds `screen_hint` unconditionally — `getSignInUrl` sends `sign-in`
 * and `getSignUpUrl` sends `sign-up` — so every provider hand-off inherits it
 * unless it is stripped here.
 *
 * Hints that describe the *user* rather than the screen (`login_hint`,
 * `domain_hint`) are deliberately absent: WorkOS forwards those upstream, so
 * they stay meaningful precisely when the hosted page is skipped.
 */
const HOSTED_PAGE_ONLY_PARAMS = ["screen_hint"] as const;

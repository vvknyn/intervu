/**
 * WorkOS AuthKit reads `NEXT_PUBLIC_WORKOS_REDIRECT_URI` only
 * (@workos-inc/authkit-nextjs/dist/esm/env-variables.js). Older local `.env.local`
 * files often set `WORKOS_REDIRECT_URI` instead, which leaves authorize URLs with
 * an empty `redirect_uri` and makes every callback fail into /auth/retry.
 */
export function normalizeWorkOsRedirectUri(raw: string): string {
    const trimmed = raw.trim();
    const url = new URL(trimmed);
    if (url.pathname === "/callback" || url.pathname === "/callback/") {
        url.pathname = "/auth/callback";
    }
    return url.toString().replace(/\/$/, "");
}

/** Resolve redirect URI from env, bridging legacy `WORKOS_REDIRECT_URI`. */
export function resolveWorkOsRedirectUriFromEnv(
    env: Pick<NodeJS.ProcessEnv, "NEXT_PUBLIC_WORKOS_REDIRECT_URI" | "WORKOS_REDIRECT_URI">,
): string | undefined {
    const raw = env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim() || env.WORKOS_REDIRECT_URI?.trim();
    if (!raw) return undefined;
    return normalizeWorkOsRedirectUri(raw);
}

/** Call before AuthKit loads so middleware and /auth/start see a redirect URI. */
export function applyWorkOsRedirectUriBridge(env: NodeJS.ProcessEnv = process.env): void {
    const resolved = resolveWorkOsRedirectUriFromEnv(env);
    if (resolved) {
        env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = resolved;
    }
}

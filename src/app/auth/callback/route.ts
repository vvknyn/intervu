import { handleAuth } from "@workos-inc/authkit-nextjs";

/**
 * WorkOS AuthKit OAuth callback route.
 * Exchanges the authorization code for a session and sets cookies.
 */
export const GET = handleAuth();

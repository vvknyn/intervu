import { signOut } from "@workos-inc/authkit-nextjs";

/**
 * WorkOS AuthKit sign-out route.
 * POST only — sign-out mutates state so it must never be a GET handler.
 */
export async function POST() {
    return signOut();
}

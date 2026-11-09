"use client";

import { useEffect, useState } from "react";
import { onAuthChange, type User } from "@/lib/firebase/client-auth";
import { resolveAuthChrome } from "@/lib/auth/chrome-state";

/**
 * Whether someone is known to be signed in. `false` until `onAuthChange` answers
 * (lib/auth/chrome-state.ts: the unresolved state is `undefined`, never `null`), so
 * server-rendered markup, which is what a crawler reads, is the signed-out version.
 * A link to a signed-in page uses it to name the sign-in address for everyone else
 * (`hrefForSignedOut`) instead of making them follow a redirect to find out.
 */
export function useSignedIn(): boolean {
    const [user, setUser] = useState<User | null | undefined>(undefined);
    useEffect(() => onAuthChange((u) => setUser(u)), []);
    return resolveAuthChrome(user) === "authenticated";
}

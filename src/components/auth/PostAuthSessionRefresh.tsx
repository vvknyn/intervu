"use client";

import { useEffect } from "react";
import { revalidateClientSession } from "@/lib/firebase/client-auth";

/**
 * After a full navigation from /auth/callback, re-read the httpOnly session
 * so chrome does not paint signed-out while the cookie is already set.
 */
export function PostAuthSessionRefresh() {
    useEffect(() => {
        if (typeof document === "undefined") return;
        if (document.referrer.includes("/auth/callback")) {
            revalidateClientSession();
        }
    }, []);
    return null;
}

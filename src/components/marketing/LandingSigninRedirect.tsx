"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";

/**
 * The landing route's ONLY `useSearchParams` consumer, isolated behind its
 * own Suspense boundary. When this hook lived in `InstrumentDeck` itself,
 * the whole page bailed out to client-side rendering (observed live
 * 2026-08-07: `/` served an empty BAILOUT_TO_CLIENT_SIDE_RENDERING shell),
 * so crawlers and no-JS link previews got a blank page. Renders nothing —
 * it only replays the `?signin=1` redirect contract.
 */
export function LandingSigninRedirect() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(() => getCurrentUser());

    useEffect(() => onAuthChange(setUser), []);

    useEffect(() => {
        if (searchParams.get("signin") !== "1" || user) return;
        const next = searchParams.get("next");
        router.replace(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }, [searchParams, user, router]);

    return null;
}

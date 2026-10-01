"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
    isAuthKitHeld,
    REQUIRE_AUTHKIT_EVENT,
    scheduleAfterLoadOrIdle,
} from "@/lib/perf/schedule-after-load-or-idle";

const AuthKitProvider = dynamic(
    () =>
        import("@workos-inc/authkit-nextjs/components").then((mod) => ({
            default: mod.AuthKitProvider,
        })),
    { ssr: false },
);

/**
 * Keeps WorkOS client bundle off the Concept A first-paint critical path.
 *
 * The provider mounts BESIDE the page, never around it. It used to wrap
 * `children` once ready, and moving the page inside a provider that was not
 * there before is a new element type at that spot, so React threw the whole
 * page away and rebuilt it: every route
 * went blank for as long as the WorkOS chunk took to load (the dynamic
 * import renders nothing meanwhile), then repainted, re-running every mount
 * fetch. Nothing reads its context (no `useAuth` anywhere; auth state comes
 * from `@/lib/firebase/client-auth`), so its session checks on focus and
 * visibility work the same from here.
 */
export function DeferredAuthKitProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const mount = () => setReady(true);
        const onRequire = () => mount();
        window.addEventListener(REQUIRE_AUTHKIT_EVENT, onRequire);
        // A held page (see `holdAuthKitUntilRequired`) mounts it through the
        // require event instead, once its first list is on screen.
        const cancelIdle = scheduleAfterLoadOrIdle(
            () => {
                if (!isAuthKitHeld()) mount();
            },
            { timeout: 5000 },
        );
        return () => {
            window.removeEventListener(REQUIRE_AUTHKIT_EVENT, onRequire);
            cancelIdle();
        };
    }, []);

    return (
        <>
            {children}
            {ready ? <AuthKitProvider>{null}</AuthKitProvider> : null}
        </>
    );
}

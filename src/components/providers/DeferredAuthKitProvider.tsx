"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
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

/** Keeps WorkOS client bundle off the Concept A first-paint critical path. */
export function DeferredAuthKitProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const mount = () => setReady(true);
        const onRequire = () => mount();
        window.addEventListener(REQUIRE_AUTHKIT_EVENT, onRequire);
        const cancelIdle = scheduleAfterLoadOrIdle(mount, { timeout: 5000 });
        return () => {
            window.removeEventListener(REQUIRE_AUTHKIT_EVENT, onRequire);
            cancelIdle();
        };
    }, []);

    // Beside the page, never around it: swapping the element above children
    // when it loaded remounted the whole page (a blank flash, open dialogs and
    // the role stack reset). Nothing on the client reads its context; it only
    // keeps the session fresh.
    return (
        <>
            {children}
            {ready ? <AuthKitProvider>{null}</AuthKitProvider> : null}
        </>
    );
}

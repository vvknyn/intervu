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

    // Mounted beside the app, not around it. Wrapping `children` once ready
    // swapped the element above every page, so React remounted the whole app
    // a moment after load: page state, focus and anything typed were lost
    // (2026-09-30, a note typed on /yours/[id] vanished). Nothing reads
    // AuthKit's context; the provider is here for its session refresh.
    return (
        <>
            {children}
            {ready ? <AuthKitProvider>{null}</AuthKitProvider> : null}
        </>
    );
}

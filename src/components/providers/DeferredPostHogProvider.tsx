"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { scheduleAfterLoadOrIdle } from "@/lib/perf/schedule-after-load-or-idle";

const PostHogProvider = dynamic(
    () => import("@/components/providers/PostHogProvider").then((m) => m.PostHogProvider),
    { ssr: false },
);

/**
 * PostHog + surveys load only after load/idle so they do not extend TBT on /jobs.
 *
 * Mounted beside the page, never around it, for the reason in
 * `DeferredAuthKitProvider`: wrapping `children` late rebuilds the whole page.
 * Nothing reads the PostHog React context (events go through
 * `@/lib/analytics/events`, surveys render themselves), so the provider only
 * has to run its init and identify effects.
 */
export function DeferredPostHogProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => scheduleAfterLoadOrIdle(() => setReady(true), { timeout: 8000 }), []);

    return (
        <>
            {children}
            {ready ? <PostHogProvider>{null}</PostHogProvider> : null}
        </>
    );
}

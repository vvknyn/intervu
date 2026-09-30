"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { scheduleAfterLoadOrIdle } from "@/lib/perf/schedule-after-load-or-idle";

const PostHogProvider = dynamic(
    () => import("@/components/providers/PostHogProvider").then((m) => m.PostHogProvider),
    { ssr: false },
);

/** PostHog + surveys load only after load/idle so they do not extend TBT on /jobs. */
export function DeferredPostHogProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => scheduleAfterLoadOrIdle(() => setReady(true), { timeout: 8000 }), []);

    // Beside the app, not around it, for the same reason as
    // DeferredAuthKitProvider: wrapping `children` once ready remounted every
    // page after load. Nothing reads PostHog's React context; capture goes
    // through the posthog-js singleton (lib/analytics/events.ts).
    return (
        <>
            {children}
            {ready ? <PostHogProvider>{null}</PostHogProvider> : null}
        </>
    );
}

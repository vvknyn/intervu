"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { hasPendingToasts, subscribe as subscribeToasts } from "@/lib/toast-store";
import { scheduleAfterLoadOrIdle } from "@/lib/perf/schedule-after-load-or-idle";

const LocalAiParamSync = dynamic(
    () =>
        import("@/components/providers/LocalAiParamSync").then((m) => ({
            default: m.LocalAiParamSync,
        })),
    { ssr: false },
);

const TourOverlay = dynamic(
    () => import("@/components/tour/TourOverlay").then((m) => ({ default: m.TourOverlay })),
    { ssr: false },
);

const Toaster = dynamic(() => import("@/lib/toast").then((m) => ({ default: m.Toaster })), {
    ssr: false,
});

const OfflineShell = dynamic(
    () => import("@/components/layout/offline-shell").then((m) => ({ default: m.OfflineShell })),
    { ssr: false },
);

/** Toasts, tour, offline banner, and AI param sync — not needed for LCP. */
export function IdleDeferredWidgets() {
    const [ready, setReady] = useState(false);

    useEffect(() => scheduleAfterLoadOrIdle(() => setReady(true), { timeout: 7000 }), []);
    // A toast fired before idle must not wait for it: mount the Toaster now.
    useEffect(() => {
        if (hasPendingToasts()) setReady(true);
        return subscribeToasts(() => {
            if (hasPendingToasts()) setReady(true);
        });
    }, []);

    if (!ready) return null;

    return (
        <>
            <LocalAiParamSync />
            <TourOverlay />
            <Toaster />
            <OfflineShell />
        </>
    );
}

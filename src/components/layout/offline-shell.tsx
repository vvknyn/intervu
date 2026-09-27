"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandLockup } from "@/components/brand/BrandMark";
import { AuthRaisedPanel } from "@/components/auth/auth-route-chrome";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function OfflineStatusPanel({
    onRetry,
    retryDisabled = false,
}: {
    onRetry?: () => void;
    retryDisabled?: boolean;
}) {
    return (
        <AuthRaisedPanel className="enter-reveal w-full max-w-100 text-center">
            <BrandLockup className="mx-auto w-fit" />
            <h1 className="mt-4 text-title-sm font-semibold text-foreground">You&apos;re offline</h1>
            <p className="mt-2 text-body-sm text-muted-foreground">
                Check your connection, then try again. If the network is down, this page may not reload until
                you&apos;re back online.
            </p>
            <Button
                type="button"
                size="sm"
                className="mt-8"
                onClick={onRetry}
                disabled={retryDisabled || !onRetry}
            >
                Retry
            </Button>
        </AuthRaisedPanel>
    );
}

/**
 * Client-only offline affordance after the app shell mounts. Does not register
 * a service worker and cannot render when the document itself fails to load.
 */
export function OfflineShell() {
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        const sync = () => setOffline(typeof navigator !== "undefined" && !navigator.onLine);
        sync();
        window.addEventListener("offline", sync);
        window.addEventListener("online", sync);
        return () => {
            window.removeEventListener("offline", sync);
            window.removeEventListener("online", sync);
        };
    }, []);

    const retry = useCallback(() => {
        window.location.reload();
    }, []);

    if (!offline) return null;

    return (
        <div
            className="fixed inset-0 z-[var(--z-toast)] flex flex-col items-center justify-center bg-background px-5 pb-12 poster-noise state-opacity-in"
            role="alert"
            data-testid="offline-shell"
        >
            <OfflineStatusPanel onRetry={retry} />
        </div>
    );
}

/** Mock gallery surface — same panel as production, not a fixed overlay. */
export function OfflineShellPanel({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex min-h-96 flex-col items-center justify-center bg-background poster-noise p-6",
                className,
            )}
            role="alert"
            data-testid="offline-shell"
        >
            <OfflineStatusPanel retryDisabled />
        </div>
    );
}

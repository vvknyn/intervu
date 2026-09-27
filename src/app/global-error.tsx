"use client";

import { useEffect } from "react";
// global-error.tsx REPLACES the root layout when the layout itself throws,
// so it must define its own <html>/<body> — but it can still pull in the
// same design tokens the layout normally provides via this same import,
// rather than hand-copying a second palette (rulebook: one source of truth
// per token) — so it renders with the primitive set like every other page.
import "./globals.css";
import { BrandLockup } from "@/components/brand/BrandMark";
import { routeStatusPanelClassName } from "@/components/layout/route-status-chrome";
import { conceptAEmptyMaxClassName } from "@/components/ui/concept-a-empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // TODO(observability): forward to Sentry once wired up.
        console.error("[global-error]", error);
    }, [error]);

    return (
        <html lang="en">
            <body className="bg-background text-foreground">
                <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 pb-12">
                    <div
                        data-testid="global-error-boundary"
                        className={cn(routeStatusPanelClassName, conceptAEmptyMaxClassName, "enter-reveal p-6 text-center sm:p-8")}
                    >
                        <BrandLockup className="mx-auto w-fit" />
                        <h1 className="mt-4 text-title-sm font-semibold text-foreground">Something went wrong</h1>
                        <p className="mt-2 text-body-sm text-muted-foreground">
                            The app failed to start this view. Please reload the page.
                        </p>
                        <Button size="sm" className="mt-8" onClick={() => reset()}>
                            Reload
                        </Button>
                    </div>
                </div>
            </body>
        </html>
    );
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";

/**
 * Route-segment error boundary. Catches render/runtime errors in any page and
 * shows a calm, branded, dark-aware fallback with a retry. Wraps the app shell,
 * so it shares the design tokens from globals.css.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(observability): forward to Sentry once wired up.
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    // Testid so suites can assert this screen is ABSENT structurally rather
    // than by matching its copy — a negative gate keyed to wording silently
    // stops testing anything the day the wording is reworded.
    <div
      data-testid="error-boundary"
      className="mx-auto flex min-h-[70vh] max-w-[480px] flex-col items-center justify-center px-6 text-center"
    >
      <BrandLockup />
      <h1 className="mt-4 text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page hit an unexpected error. Nothing you did was lost — try again, and if
        it keeps happening, reload the app.
      </p>
      {error?.digest ? (
        <p className="mt-3 text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-8 flex items-center gap-3">
        <Button asChild size="sm">
          <Link href="/jobs">Go to jobs</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}

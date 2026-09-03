"use client";

import { useEffect } from "react";
import { BrandLockupMark } from "@/components/brand/BrandMark";

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
      className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center"
    >
      <BrandLockupMark tileClassName="h-12 w-12 rounded-none" markClassName="h-7 w-7" />
      <span className="mt-4 font-display text-xs font-semibold text-muted-foreground">
        velai
      </span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-foreground">
        Something went sideways
      </h1>
      <p className="mt-2 max-w-md text-text-2">
        This page hit an unexpected error. Nothing you did was lost — try again, and if
        it keeps happening, reload the app.
      </p>
      {error?.digest ? (
        <p className="mt-3 text-xs text-text-3">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-none bg-brand px-5 py-2.5 text-sm text-brand-foreground transition hover:opacity-90 focus-ring"
        >
          Try again
        </button>
        <a
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          or go home
        </a>
      </div>
    </div>
  );
}

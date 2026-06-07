"use client";

import { useEffect } from "react";

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
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden="true">
          <path
            d="M9 13 L19 28 L31 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.4"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
        Something went sideways
      </h1>
      <p className="mt-2 max-w-md text-text-2">
        An unexpected error stopped this page from loading. Your data is safe — try
        again, and if it keeps happening, reload the app.
      </p>
      {error?.digest ? (
        <p className="mt-3 font-mono text-xs text-text-3">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition hover:opacity-90 focus-ring"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-hover focus-ring"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

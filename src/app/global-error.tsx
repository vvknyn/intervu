"use client";

import { useEffect } from "react";
// global-error.tsx REPLACES the root layout when the layout itself throws,
// so it must define its own <html>/<body> — but it can still pull in the
// same design tokens the layout normally provides via this same import,
// rather than hand-copying a second palette (rulebook: one source of truth
// per token) — so it renders with the primitive set like every other page.
import "./globals.css";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";

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
        <div className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center px-6 text-center">
          <BrandLockup />
          <h1 className="mt-4 text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app failed to start this view. Please reload the page.
          </p>
          <Button size="sm" className="mt-8" onClick={() => reset()}>
            Reload
          </Button>
        </div>
      </body>
    </html>
  );
}

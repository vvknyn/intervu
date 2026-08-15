"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinConnectWaitlist } from "@/actions/connect-waitlist";
import { resolveWaitlistOutcome } from "./waitlist-outcome";

interface OpenclawWaitlistFormProps {
  ctaLabel?: string;
  successMessage?: string;
  className?: string;
}

/**
 * Shared waitlist form for every OpenClaw placement (landing hero, landing
 * closing, /openclaw hero and closing) — same local-state shape as
 * /connect's `WaitlistBand` (connect-client.tsx), reused rather than
 * reforked. `client` is fixed to "openclaw" on every one of these
 * placements, so unlike `WaitlistBand` this takes no client id — only the
 * copy that actually differs per placement is a prop.
 */
export function OpenclawWaitlistForm({
  ctaLabel = "Email me when it's ready",
  successMessage = "You're on the list — we'll email you the moment the OpenClaw skill is installable.",
  className,
}: OpenclawWaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: true } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await joinConnectWaitlist({ email, client: "openclaw" });
      setResult(res);
    });
  };

  const outcome = result ? resolveWaitlistOutcome(result) : null;

  return (
    <div className={className}>
      {outcome?.kind === "success" ? (
        <p className="text-sm font-medium text-brand" data-testid="openclaw-waitlist-success">
          {successMessage}
        </p>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={pending}
              aria-label="Email address"
              className="min-h-11 rounded-lg border border-slate-300 bg-card text-foreground placeholder:text-muted-foreground sm:min-w-0 sm:flex-1 dark:border-slate-700 shadow-2xs"
            />
            <Button
              type="submit"
              disabled={pending}
              className="min-h-11 w-full shrink-0 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 sm:w-auto dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 shadow-2xs"
            >
              {pending ? "Joining…" : ctaLabel}
            </Button>
          </form>
          {outcome?.kind === "error" ? (
            <p className="mt-2 text-sm text-foreground" data-testid="openclaw-waitlist-error">
              {outcome.message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

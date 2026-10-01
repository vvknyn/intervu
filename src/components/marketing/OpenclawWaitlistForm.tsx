"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinConnectWaitlist } from "@/actions/connect-waitlist";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after a refused submit: the token it sent is spent (single-use).
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: true } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await joinConnectWaitlist({ email, client: "openclaw", turnstileToken: turnstileToken ?? undefined });
      setResult(res);
      if (!res.success) setTurnstileResetKey((key) => key + 1);
    });
  };

  const outcome = result ? resolveWaitlistOutcome(result) : null;

  return (
    <div className={className}>
      {outcome?.kind === "success" ? (
        <p className="text-sm text-foreground" data-testid="openclaw-waitlist-success">
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
              className="ctl-lg sm:min-w-0 sm:flex-1"
            />
            {/* control-type-allow: shares the sm+ form row with the 44px email field (one row, one step — J-NAV-34) */}
            <Button size="lg" type="submit" disabled={pending} className="w-full shrink-0 sm:w-auto">
              {pending ? "Joining…" : ctaLabel}
            </Button>
          </form>
          <TurnstileWidget surface="waitlist" onVerify={setTurnstileToken} resetKey={turnstileResetKey} />
          {outcome?.kind === "error" ? (
            <p className="mt-2 text-sm text-destructive" data-testid="openclaw-waitlist-error">
              {outcome.message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { reserveFoundingSeat } from "@/actions/founding-seat";
import { resolveWaitlistOutcome } from "@/components/marketing/waitlist-outcome";
import { captureEvent } from "@/lib/analytics/events";

type FoundingReserveFormProps = {
  /** The signed-in account's address, prefilled but still editable. */
  email: string | null;
  signedIn: boolean;
};

/**
 * The founding button while `FOUNDING_MEMBER_CHECKOUT_URL` is unset: a
 * reservation instead of an inert "open soon" (Vivek, 2026-09-29: "put a
 * placeholder for now"). Same shape as /connect's waitlist
 * (OpenclawWaitlistForm): email, Turnstile, one server action that upserts
 * by address and sends one confirmation. Nothing is charged; the row is
 * what gets the checkout link first once the Stripe link exists.
 */
export function FoundingReserveForm({ email: initialEmail, signedIn }: FoundingReserveFormProps) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after a refused submit: the token it sent is spent (single-use).
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: true } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    captureEvent("upgrade_clicked", { plan: "pro_founding", signed_in: signedIn, mode: "reserve" });
    startTransition(async () => {
      const res = await reserveFoundingSeat({ email, turnstileToken: turnstileToken ?? undefined });
      setResult(res);
      if (res.success) captureEvent("founding_seat_reserved", { signed_in: signedIn });
      else setTurnstileResetKey((key) => key + 1);
    });
  };

  const outcome = result ? resolveWaitlistOutcome(result) : null;

  if (outcome?.kind === "success") {
    return (
      <p data-testid="pricing-founding-reserved" className="mt-3 text-sm text-foreground">
        Seat reserved. Nothing is charged: when seats open, this address gets the checkout link first, and you can
        still say no.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <Input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={pending}
        aria-label="Email address for your founding seat"
        data-testid="pricing-founding-email"
        className="w-full"
      />
      <Button type="submit" data-testid="pricing-founding-cta" className="mt-2 w-full" disabled={pending}>
        {pending ? "Reserving…" : "Reserve a founding seat"}
      </Button>
      <TurnstileWidget surface="waitlist" onVerify={setTurnstileToken} resetKey={turnstileResetKey} />
      {outcome?.kind === "error" ? (
        <p data-testid="pricing-founding-error" className="mt-2 text-sm text-destructive">
          {outcome.message}
        </p>
      ) : null}
    </form>
  );
}

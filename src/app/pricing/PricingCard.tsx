"use client";

import { useState, type FormEvent } from "react";
import { WarningCircle, Spinner } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { applicationsPerPack, type Pack } from "@/lib/pricing";
import { submitWaitlistAction } from "@/actions/waitlist";

/**
 * One credit-pack card: price/credits sourced from `pack` (never
 * re-enumerated), a "Join the waitlist" CTA that reveals an inline email
 * form on click, and a honeypot field a real visitor never reaches. The
 * `hunt` pack gets the visual highlight — matched on `pack.id`, not
 * position, so reordering PACKS doesn't silently move the highlight.
 */
export function PricingCard({ pack }: { pack: Pack }) {
  const highlighted = pack.id === "hunt";
  const title = pack.id.charAt(0).toUpperCase() + pack.id.slice(1);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const result = await submitWaitlistAction({ email, packId: pack.id, honeypot });
      if ("success" in result) {
        setStatus("success");
      } else {
        setStatus("error");
        setError(result.error);
      }
    } catch (err) {
      console.error("Waitlist submit failed:", err);
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <div
      data-testid={`pricing-card-${pack.id}`}
      className={cn(
        "flex flex-col gap-4 p-6",
        highlighted ? "relative border-2 border-foreground bg-background" : "border border-border bg-background",
      )}
    >
      {highlighted && (
        <span className="absolute -top-3 left-[18px] bg-brand px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase leading-none tracking-[0.12em] text-brand-foreground">
          Most popular
        </span>
      )}

      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 font-mono text-[32px] font-medium leading-none text-foreground">${pack.usd}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-mono">{pack.credits}</span> credits · never expire
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        ≈<span className="font-mono">{applicationsPerPack(pack)}</span> tailored applications
      </p>

      {status === "success" ? (
        <p className="text-sm text-brand" data-testid={`pricing-card-${pack.id}-success`}>
          You&apos;re on the list — we&apos;ll email you when packs go live.
        </p>
      ) : showForm ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "loading"}
            aria-label="Email address"
          />

          {/* Honeypot: visually hidden, out of tab order, and aria-hidden —
              a real visitor never sees or reaches this field. A filled
              value silently drops the submission server-side without ever
              telling the caller it was dropped (see validateWaitlistInput). */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor={`website-${pack.id}`}>Leave this field blank</label>
            <input
              id={`website-${pack.id}`}
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {status === "error" && error && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <WarningCircle size={14} weight="fill" />
              {error}
            </p>
          )}

          <Button type="submit" variant={highlighted ? "default" : "outline"} disabled={status === "loading"}>
            {status === "loading" && <Spinner className="h-4 w-4 animate-spin" />}
            Join the waitlist
          </Button>
        </form>
      ) : (
        <Button type="button" variant={highlighted ? "default" : "outline"} onClick={() => setShowForm(true)}>
          Join the waitlist
        </Button>
      )}
    </div>
  );
}

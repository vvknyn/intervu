"use client";

/**
 * The one-field email step behind CompanyFollowControl's persist CTA
 * (docs/specs/2026-08-19-verified-email-follow-design.md, "What ships" #1).
 * A reusable primitive with no company knowledge baked in beyond the props
 * it's given — v1 mounts it only on the company page. Posts straight to
 * POST /api/follow-email (submit-follow.ts does the real decision-making);
 * this component only tracks idle/submitting/sent/error and renders the
 * matching copy from persist-copy.ts.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { followEmailPrompt, followEmailSentLine } from "@/lib/follows/persist-copy";

export interface FollowEmailStepProps {
  companyDomain: string;
  displayName: string;
  onSignInInstead(): void;
}

type Status = "idle" | "submitting" | "sent" | "error";

export function FollowEmailStep({ companyDomain, displayName, onSignInInstead }: FollowEmailStepProps) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");

    try {
      const res = await fetch("/api/follow-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          companyDomain,
          displayName,
          redirectPath: window.location.pathname,
          turnstileToken,
        }),
      });
      // 400 (rejected: bad email/turnstile) and 503 (PG unavailable) both
      // land here — an honest retry line, never a fabricated "sent".
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div data-testid="follow-email-step" className="max-w-[220px] text-right">
        <p className="text-xs leading-snug text-muted-foreground">{followEmailSentLine()}</p>
      </div>
    );
  }

  return (
    <div data-testid="follow-email-step" className="max-w-[220px] text-right">
      <form onSubmit={handleSubmit} className="space-y-2">
        <p className="text-xs leading-snug text-muted-foreground">{followEmailPrompt(displayName)}</p>
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          data-testid="follow-email-input"
          className="h-9 text-xs"
        />
        <TurnstileWidget onVerify={setTurnstileToken} />
        {status === "error" && (
          <p className="text-xs text-destructive">Couldn&apos;t send that — try again.</p>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={status === "submitting"}
          className="h-8 w-full text-xs"
        >
          {status === "submitting" ? "Sending…" : "Send confirmation"}
        </Button>
      </form>
      <Button
        type="button"
        variant="link"
        size="sm"
        data-testid="follow-email-signin"
        onClick={onSignInInstead}
        className="mt-1 h-auto px-0 py-0 text-xs font-medium text-muted-foreground"
      >
        Have an account? Sign in
      </Button>
    </div>
  );
}

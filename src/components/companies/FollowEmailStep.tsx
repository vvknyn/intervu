"use client";

/**
 * The one-field email step (docs/specs/2026-08-19-verified-email-follow-design.md,
 * "What ships" #1). `FollowButton` opens this directly on a signed-out
 * follow click — every FollowButton surface gets it, not just the company
 * page. A reusable primitive with no company knowledge baked in beyond the
 * props it's given. Posts straight to POST /api/follow-email
 * (submit-follow.ts does the real decision-making); this component only
 * tracks idle/submitting/sent/error and renders the matching copy from
 * persist-copy.ts.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { followEmailPrompt, followEmailSentLine } from "@/lib/follows/persist-copy";
import { recordFollowFunnelAction } from "@/actions/follow-funnel";

export interface FollowEmailStepProps {
  companyDomain: string;
  displayName: string;
  /** Omit to hide the "sign in instead" link — a bare mount (e.g. the
   *  hot-table pill) has no auth popover of its own to hand off to. */
  onSignInInstead?(): void;
}

type Status = "idle" | "submitting" | "sent" | "error";

export function FollowEmailStep({ companyDomain, displayName, onSignInInstead }: FollowEmailStepProps) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  // This component only ever mounts once a signed-out Follow click has
  // opened it (FollowButton renders it behind `emailStepOpen`), so mount IS
  // the cta_click funnel event ("email step opened") — recorded once per
  // mount, not per render.
  useEffect(() => {
    void recordFollowFunnelAction("cta_click", companyDomain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    void recordFollowFunnelAction("email_submitted", companyDomain);

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
      // land here — an honest retry line, never a fabricated "sent". A
      // Turnstile refusal carries its own actionable `message`.
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setRejectMessage(body?.message ?? null);
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
          className="ctl-md text-xs"
        />
        <TurnstileWidget surface="follow_email" onVerify={setTurnstileToken} />
        {status === "error" && (
          <p className="text-xs text-destructive">{rejectMessage ?? "Couldn't send that — try again."}</p>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={status === "submitting"}
          className="w-full"
        >
          {status === "submitting" ? "Sending…" : "Send confirmation"}
        </Button>
      </form>
      {onSignInInstead && (
        <Button
          type="button"
          variant="link"
          size="link"
          data-testid="follow-email-signin"
          onClick={onSignInInstead}
          // control-type-allow: an inline text link (size="link") set with the 12px form copy around it
          className="mt-1 text-xs text-muted-foreground"
        >
          Have an account? Sign in
        </Button>
      )}
    </div>
  );
}

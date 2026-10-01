"use client";

/**
 * Anonymous weekly search alert capture — signed-out /jobs only. Posts to
 * POST /api/search-alerts; mirrors FollowEmailStep + AccountEmailPrompt styling.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { captureEvent } from "@/lib/analytics/events";
import { getPostHogClient } from "@/lib/analytics/posthog-client";
import { markSearchAlertSubmitted } from "@/lib/jobs/search-alert-capture";

/** Never throws — a missing/unavailable PostHog distinct id must not block
 *  the alert submission it would otherwise ride along with. */
function readPosthogDistinctId(): string | null {
  try {
    return getPostHogClient()?.get_distinct_id() || null;
  } catch {
    return null;
  }
}

export interface SearchAlertCaptureProps {
  surface: "zero_results" | "results";
  searchName: string;
  searchHref: string;
  filterCount: number;
  queryLength: number;
  hasResults: boolean;
  onDismiss(): void;
}

type Status = "idle" | "submitting" | "sent" | "error";

export function SearchAlertCapture({
  surface,
  searchName,
  searchHref,
  filterCount,
  queryLength,
  hasResults,
  onDismiss,
}: SearchAlertCaptureProps) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  useEffect(() => {
    captureEvent("search_alert_impressed", {
      surface,
      query_length: queryLength,
      filter_count: filterCount,
      has_results: hasResults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    captureEvent("search_alert_dismissed", {
      surface,
      query_length: queryLength,
      filter_count: filterCount,
      has_results: hasResults,
    });
    onDismiss();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");

    // `search_alert_submitted` is captured server-side now (POST /api/
    // search-alerts, on request completion) — that's the one place this
    // event can't be dropped by the browser navigating away before a
    // client-side capture fires. See src/lib/analytics/server-capture.ts.
    try {
      const res = await fetch("/api/search-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: searchName,
          href: searchHref,
          redirectPath: window.location.pathname + window.location.search,
          turnstileToken,
          // Read defensively: get_distinct_id() is documented as safe once
          // posthog.init() has run, but that never happens at all when
          // NEXT_PUBLIC_POSTHOG_KEY is unset — a missing distinct id must
          // never block the alert submission itself, only the analytics
          // capture riding along with it.
          distinctId: readPosthogDistinctId(),
          surface,
          queryLength,
          filterCount,
          hasResults,
        }),
      });
      if (res.ok) {
        markSearchAlertSubmitted();
        setStatus("sent");
      } else {
        // A Turnstile refusal carries its own actionable `message`.
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setRejectMessage(body?.message ?? null);
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div data-testid="search-alert-capture" className="mt-4 max-w-md text-left">
        <p className="text-sm">Check your inbox to confirm.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          We sent a one-click link — confirm it and weekly alerts start.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="search-alert-capture" className="mt-4 max-w-md text-left">
      <p className="text-sm">Get new matches by email</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Weekly. Unsubscribe anytime.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          data-testid="search-alert-email-input"
          className="ctl-md w-full max-w-[260px] text-base"
        />
        <TurnstileWidget surface="search_alert" onVerify={setTurnstileToken} />
        {status === "error" && (
          <p className="w-full text-xs text-destructive" data-testid="search-alert-error">
            {rejectMessage ?? "Couldn't send that — try again."}
          </p>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={status === "submitting"}
          data-testid="search-alert-submit"
        >
          {status === "submitting" ? "Sending…" : "Email me new jobs"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          data-testid="search-alert-dismiss"
        >
          Not now
        </Button>
      </form>
    </div>
  );
}

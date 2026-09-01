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
import { markSearchAlertSubmitted } from "@/lib/jobs/search-alert-capture";

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
        }),
      });
      const outcome = res.ok ? ("accepted" as const) : ("rejected" as const);
      captureEvent("search_alert_submitted", {
        surface,
        query_length: queryLength,
        filter_count: filterCount,
        has_results: hasResults,
        outcome,
      });
      if (res.ok) {
        markSearchAlertSubmitted();
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      captureEvent("search_alert_submitted", {
        surface,
        query_length: queryLength,
        filter_count: filterCount,
        has_results: hasResults,
        outcome: "rejected",
      });
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div data-testid="search-alert-capture" className="mt-4 max-w-md text-left">
        <p className="text-sm font-medium">Check your inbox to confirm.</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          We sent a one-click link — confirm it and weekly alerts start.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="search-alert-capture" className="mt-4 max-w-md text-left">
      <p className="text-sm font-medium">Get new matches by email</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
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
          className="h-9 w-full max-w-[260px] text-base"
        />
        <TurnstileWidget onVerify={setTurnstileToken} />
        {status === "error" && (
          <p className="w-full text-xs text-destructive" data-testid="search-alert-error">
            Couldn&apos;t send that — try again.
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

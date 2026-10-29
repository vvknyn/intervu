"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { Prose, READING_MEASURE } from "@/components/ui/prose";
import { PageContainer } from "@/components/layout/PageContainer";
import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils";
import { PAID_FEATURES } from "@/lib/jobs/resume-privacy-copy";
import { captureEvent } from "@/lib/analytics/events";
import { PERSONAL_EMAIL_HINT } from "@/lib/auth/auth-gate-copy";
import {
  MONTH_CHOICES,
  PRO_MONTHLY_PRICE,
  REFUND_DAYS,
  formatPaidUntil,
  monthsLabel,
  totalPrice,
} from "./offer";
import { Disclosure, DisclosureSummary } from "@/components/ui/disclosure";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type PricingClientProps = {
  signedIn: boolean;
  /** False when the server has no Stripe key or price: the card says so and renders no button. */
  billingConfigured: boolean;
  /** True when a recurring monthly price is set too: the card then offers month to month beside prepaid months. */
  autoRenewConfigured?: boolean;
  /** True while the account's month-to-month subscription is live: it is managed in Settings, not bought again. */
  autoRenewing?: boolean;
  /** Epoch ms the account's access runs to, or null when it has none now. */
  paidUntil: number | null;
  /** True when the paid-time read failed: the card says so; buying stays open. */
  paidStatusUnknown?: boolean;
};

const FREE_FEATURES = [
  "Job search and matching, using a résumé kept on your device",
  "The application tracker and saved jobs",
];

const FAQ: { question: string; answer: string }[] = [
  {
    question: "Is my data being sold?",
    answer:
      "No. Velai does not sell your data, your résumé or anything about you. The privacy policy has the full list.",
  },
];

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const CHECKOUT_FALLBACK_ERROR = "Checkout didn't start. Try again in a minute.";

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm text-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

type PayMode = "prepaid" | "monthly";

export function PricingClient({
  signedIn,
  billingConfigured,
  autoRenewConfigured = false,
  autoRenewing = false,
  paidUntil,
  paidStatusUnknown = false,
}: PricingClientProps) {
  const [months, setMonths] = useState(1);
  const [mode, setMode] = useState<PayMode>("prepaid");
  const monthly = mode === "monthly" && autoRenewConfigured && !autoRenewing;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    captureEvent("pricing_viewed", { signed_in: signedIn });
  }, [signedIn]);

  async function buy() {
    setBusy(true);
    setError(null);
    captureEvent("upgrade_clicked", monthly ? { signed_in: signedIn, months: 1, auto_renew: true } : { signed_in: signedIn, months });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(monthly ? { autoRenew: true } : { months }),
      });
      // load-result-allow: an unreadable reply falls to CHECKOUT_FALLBACK_ERROR on the page and Buy comes back; nothing renders as empty
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body?.error ?? CHECKOUT_FALLBACK_ERROR);
    } catch {
      setError(CHECKOUT_FALLBACK_ERROR);
    }
    setBusy(false);
  }

  return (
    <PageContainer data-testid="pricing-page" className="py-10">
      <p className="text-xs font-semibold text-muted-foreground">Pricing</p>
      <PageTitle className="mt-3">One plan, {PRO_MONTHLY_PRICE} a month.</PageTitle>
      <p className={`mt-1.5 ${READING_MEASURE} text-base text-muted-foreground`}>
        Searching is free. A paid month covers the parts where Velai keeps or reads your résumé for you.
      </p>

      <Card data-testid="pricing-card" className="mt-8 max-w-xl border border-brand">
        <p className="text-2xl font-semibold text-foreground">
          {PRO_MONTHLY_PRICE}
          <span className="text-sm font-normal text-muted-foreground"> / month</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Each month is 30 days of access.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Buy 1 to 12 months at a time. One payment, no auto-renew, no trial, and a {REFUND_DAYS}-day refund.
        </p>
        {autoRenewConfigured ? (
          <p data-testid="pricing-monthly-note" className="mt-1 text-sm text-muted-foreground">
            Or pay month to month: {PRO_MONTHLY_PRICE} each month until you cancel, with the same refund.
          </p>
        ) : null}

        <p className="mt-5 text-sm font-semibold text-foreground">Always free</p>
        <FeatureList items={FREE_FEATURES} />

        <p className="mt-5 text-sm font-semibold text-foreground">Each month adds</p>
        <FeatureList items={PAID_FEATURES.map(upperFirst)} />

        {autoRenewing ? (
          <p data-testid="pricing-auto-renewing" className="mt-5 text-sm font-semibold text-foreground">
            Month to month is on{paidUntil !== null ? `. Next payment ${formatPaidUntil(paidUntil)}` : ""}.{" "}
            <Link href="/settings?tab=account" className="font-normal underline">Manage it in Settings</Link>
          </p>
        ) : paidUntil !== null ? (
          <p data-testid="pricing-paid-until" className="mt-5 text-sm font-semibold text-foreground">
            Paid until {formatPaidUntil(paidUntil)}
          </p>
        ) : null}
        {paidStatusUnknown ? (
          <p data-testid="pricing-paid-unknown" className="mt-5 text-sm text-muted-foreground">
            We couldn&apos;t check your paid time just now. You can still buy; any time you already have is kept.
          </p>
        ) : null}

        <div className="mt-5 border-t border-border pt-4">
          {billingConfigured ? (
            <>
              {autoRenewConfigured && !autoRenewing ? (
                <ToggleGroup
                  role="radiogroup"
                  aria-label="How to pay"
                  className="mb-4 flex flex-wrap gap-2"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as PayMode)}
                >
                  <ToggleGroupItem value="prepaid" data-testid="pricing-mode-prepaid">Pay once</ToggleGroupItem>
                  <ToggleGroupItem value="monthly" data-testid="pricing-mode-monthly">Month to month</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {monthly ? null : (
                <>
                  <label htmlFor="pricing-months" className="text-sm font-semibold text-foreground">
                    How many months
                  </label>
                  <select
                    id="pricing-months"
                    data-testid="pricing-months"
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                    className={cn("mt-1.5 ctl-lg w-full rounded-ctl border border-border bg-card px-3 text-base outline-none", CONTROL_FOCUS_VISIBLE)}
                  >
                    {MONTH_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {monthsLabel(m)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <p data-testid="pricing-total" className="mt-2 text-sm text-muted-foreground">
                {monthly
                  ? `${PRO_MONTHLY_PRICE} every month until you cancel. Cancel any time in Settings; the month you've paid for stays active.`
                  : `Total: ${totalPrice(months)} for ${monthsLabel(months)}`}
              </p>
              {signedIn ? (
                <Button data-testid="pricing-buy" className="mt-3 w-full" disabled={busy} onClick={() => void buy()}>
                  {monthly
                    ? `Pay ${PRO_MONTHLY_PRICE} a month`
                    : `${paidUntil !== null ? "Add" : "Buy"} ${monthsLabel(months)} for ${totalPrice(months)}`}
                </Button>
              ) : (
                <Button asChild className="mt-3 w-full">
                  <Link data-testid="pricing-sign-in" href="/auth/start?next=/pricing">Sign in to buy</Link>{/* signup-gate-exempt: the buy button's own sign-in step, not a gate prompt */}
                </Button>
              )}
              {!signedIn && <p className="mt-2 text-xs text-muted-foreground">{PERSONAL_EMAIL_HINT}</p>}
              {error ? (
                <p role="alert" data-testid="pricing-error" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <p data-testid="pricing-soon" className="text-sm font-semibold text-foreground">
              Payments open soon
            </p>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          We don&apos;t sell your data or your résumé. How we handle it is in the{" "}
          <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>
      </Card>

      <Prose className="mt-10">
        <SectionTitle>Questions</SectionTitle>
        {FAQ.map((item) => (
          <Disclosure key={item.question} className="mt-3 border-b border-border pb-3 last:border-b-0">
            <DisclosureSummary className="font-semibold text-foreground">{item.question}</DisclosureSummary>
            <p className="mt-2 text-muted-foreground">{item.answer}</p>
          </Disclosure>
        ))}
        <p className="mt-6 text-sm text-muted-foreground">
          Refunds and billing are written into the <Link href="/terms">terms</Link>.
        </p>
      </Prose>
    </PageContainer>
  );
}

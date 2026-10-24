"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { Prose } from "@/components/ui/prose";
import { PageContainer } from "@/components/layout/PageContainer";
import { FoundingReserveForm } from "./founding-reserve-form";
import { captureEvent, type UpgradePlan } from "@/lib/analytics/events";
import {
  FOUNDING_SEAT_COUNT,
  FOUNDING_SEAT_PRICE,
  PRO_MONTHLY_PRICE,
} from "@/lib/billing/founding-offer";

type PricingClientProps = {
  signedIn: boolean;
  /** The signed-in account's address, to prefill the reservation form. */
  email: string | null;
  /** Stripe Payment Link with the buyer's reference attached, or `null`
   *  when the offer is not configured — the Pro column then takes an
   *  email-only reservation (FoundingReserveForm), never a guessed URL. */
  checkoutUrl: string | null;
  /** Set only on a validated Stripe return; drives the thank-you and the
   *  one `founding_member_paid` capture. */
  paidSessionId: string | null;
};

/** One capture per checkout session per browser session, so a reload of
 *  the return URL never double-counts a purchase. `sessionStorage` can
 *  throw (private mode, blocked storage) — then the event fires once per
 *  render, which over-counts rather than drops, and Stripe stays the ledger. */
const PAID_CAPTURE_KEY = "velai.pricing.paid";

const FREE_FEATURES = [
  "Search employers' own career pages, screened for stale postings",
  "Résumé upload, match scores and tailoring",
  "Application tracker, saved jobs and followed companies",
  "Search alerts by email",
  "Connect Claude, Cursor or another AI client through MCP at today's limits",
];

const PRO_FEATURES = [
  "Everything in Free, with no new limits on what you use today",
  "Unlimited tailoring and résumé variants per application",
  "Instant alerts when a posting that matches you goes live",
  "Higher MCP quotas for your AI client",
  "A founding badge and a say in what ships next",
];

const FAQ: { question: string; answer: string }[] = [
  {
    question: "Will anything I use today start costing money?",
    answer:
      "No. Free is today's product at today's limits. If a paid plan ever changes what Free includes, it will be on this page and in the terms first, and nothing you already use moves behind a paywall without notice.",
  },
  {
    question: "What does a founding seat buy?",
    answer: `Pro for the life of the account, for a one-off ${FOUNDING_SEAT_PRICE}. There are ${FOUNDING_SEAT_COUNT} seats. Founding members get Pro the day it opens and set its roadmap with us until then.`,
  },
  {
    question: "What does reserving a seat do?",
    answer: `It holds your place in the first ${FOUNDING_SEAT_COUNT} and costs nothing. When seats open, reservations get the checkout link before anyone else; if you have changed your mind by then, ignore the email.`,
  },
  {
    question: "What if Pro never opens?",
    answer:
      "You get your money back. A founding seat is refundable on request at any time before Pro opens, no reason needed. Use the contact page and include the email you paid with.",
  },
  {
    question: "Is my data being sold?",
    answer:
      "No. Velai does not sell your data, your résumé or anything about you. The privacy policy has the full list.",
  },
];

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm text-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingClient({ signedIn, email, checkoutUrl, paidSessionId }: PricingClientProps) {
  const foundingAvailable = checkoutUrl !== null;

  useEffect(() => {
    captureEvent("pricing_viewed", { signed_in: signedIn, founding_available: foundingAvailable });
  }, [signedIn, foundingAvailable]);

  useEffect(() => {
    if (!paidSessionId) return;
    try {
      if (sessionStorage.getItem(PAID_CAPTURE_KEY) === paidSessionId) return;
      sessionStorage.setItem(PAID_CAPTURE_KEY, paidSessionId);
    } catch {
      // Storage unavailable — capture anyway; see PAID_CAPTURE_KEY.
    }
    captureEvent("founding_member_paid", { signed_in: signedIn });
  }, [paidSessionId, signedIn]);

  const clicked = (plan: UpgradePlan, mode?: "checkout" | "reserve") =>
    captureEvent("upgrade_clicked", { plan, signed_in: signedIn, mode });

  return (
    <PageContainer data-testid="pricing-page" className="py-10">
      <p className="text-xs font-semibold text-muted-foreground">Pricing</p>
      <PageTitle className="mt-3">Free while you search. Pay only if you want more.</PageTitle>
      <p className="mt-1.5 max-w-prose text-base text-muted-foreground">
        Everything you use today stays free. Pro is on the way, and the first{" "}
        {FOUNDING_SEAT_COUNT} Pro seats{" "}
        {foundingAvailable
          ? "are open now at a one-off price."
          : "open soon at a one-off price. Reserve yours now; nothing is charged until they open."}
      </p>

      {paidSessionId ? (
        <Card data-testid="pricing-paid-banner" className="mt-6 border-brand">
          <p className="text-base font-semibold text-foreground">You have a founding seat. Thank you.</p>
          <p className="text-sm text-muted-foreground">
            Your receipt is in your email from Stripe. We will write to that address the day Pro opens, and before
            then whenever there is a decision founding members should make with us.
          </p>
        </Card>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card data-testid="pricing-plan-free">
          <div>
            <p className="text-sm font-semibold text-foreground">Free</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">$0</p>
            <p className="mt-1 text-sm text-muted-foreground">What you use today. No card, no trial clock.</p>
          </div>
          <FeatureList items={FREE_FEATURES} />
          <div className="mt-auto pt-2">
            {signedIn ? (
              <Button asChild variant="outline" className="w-full">
                <Link href="/jobs">You are on Free. Go to jobs</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="w-full">
                {/* `asChild` renders through a Radix Slot, which takes exactly ONE
                    child: keep the Link the only thing on its line (release 6 shipped
                    a stray space after it and /pricing threw React.Children.only). */}
                <Link href="/auth/start?mode=signup&next=/jobs">Create free account{/* signup-gate-exempt: the Free plan's own door, not a gate on an action */}</Link>
              </Button>
            )}
          </div>
        </Card>

        <Card data-testid="pricing-plan-pro" className="border-brand">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Pro</p>
              <Badge>{foundingAvailable ? "Founding seats open" : "Reservations open"}</Badge>
            </div>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {PRO_MONTHLY_PRICE}
              <span className="text-sm font-normal text-muted-foreground"> / month when it opens</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">A serious search: more of the thing that gets replies.</p>
          </div>
          <FeatureList items={PRO_FEATURES} />
          <div className="mt-auto pt-2">
            <div className="rounded-panel border border-border bg-muted p-3">
              <p className="text-sm font-semibold text-foreground">
                Founding seat: {FOUNDING_SEAT_PRICE} once, Pro for life
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {checkoutUrl
                  ? `First ${FOUNDING_SEAT_COUNT} seats. Refundable on request any time before Pro opens.`
                  : `First ${FOUNDING_SEAT_COUNT} seats. Reserve with an email; nothing is charged until they open, and a seat is refundable on request any time before Pro opens.`}
              </p>
              {checkoutUrl ? (
                <Button asChild className="mt-3 w-full">
                  <a
                    data-testid="pricing-founding-cta"
                    href={checkoutUrl}
                    onClick={() => clicked("pro_founding", "checkout")}
                  >
                    Take a founding seat
                  </a>
                </Button>
              ) : (
                <FoundingReserveForm email={email} signedIn={signedIn} />
              )}
            </div>
          </div>
        </Card>
      </div>

      <Prose className="mt-10">
        <SectionTitle>Questions</SectionTitle>
        {FAQ.map((item) => (
          <details key={item.question} className="mt-3 border-b border-border pb-3 last:border-b-0">
            <summary className="cursor-pointer font-semibold text-foreground">{item.question}</summary>
            <p className="mt-2 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
        <p className="mt-6 text-sm text-muted-foreground">
          The founding offer and refunds are written into the{" "}
          <Link href="/terms">terms</Link> and the <Link href="/privacy">privacy policy</Link>.
        </p>
      </Prose>
    </PageContainer>
  );
}

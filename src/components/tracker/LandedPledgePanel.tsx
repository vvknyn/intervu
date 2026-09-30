"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { captureEvent } from "@/lib/analytics/events";
import { LANDED_PLEDGE_SUGGESTED } from "@/lib/billing/founding-offer";
import { usePledgeUrl } from "@/lib/billing/pledge-context";
import { boardColumn, type Pursuit } from "@/lib/pursuits/types";

type LandedPledgePanelProps = {
  /** Stripe Payment Link with the buyer attached, or null when
   *  LANDED_PLEDGE_CHECKOUT_URL is unset on the server. */
  pledgeUrl: string | null;
  /** The pursuit's listing id, null for a hand-tracked role; keys the event
   *  the same way `application_stage_changed` does. */
  jobId: string | null;
};

/**
 * The "pay when you land it" moment (strategy decision 7): shown in the
 * pursuit detail sheet once a pursuit sits in the Offer lane. Honour-based
 * and voluntary; nothing on the site is gated by it and the tracker keeps
 * working whether or not anyone pays. With no link configured the panel
 * still marks the moment and asks how it went, which is the outcome signal
 * the pledge exists to collect.
 */
export function LandedPledgePanel({ pledgeUrl, jobId }: LandedPledgePanelProps) {
  return (
    <div data-testid="landed-pledge" className="rounded-panel border border-brand bg-muted p-3.5">
      <p className="text-sm font-semibold text-foreground">Offer in hand. Well done.</p>
      {pledgeUrl ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Velai was free the whole way. If it helped you land this, pay it forward: {LANDED_PLEDGE_SUGGESTED}{" "}
            suggested, any amount, one time. Only once you have signed, and only if you want to.
          </p>
          <Button asChild className="mt-3 w-full sm:w-auto">
            <a data-testid="landed-pledge-pay" href={pledgeUrl} onClick={() => captureEvent("landed_pledge_clicked", { job_id: jobId })}>Pay it forward</a>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Velai was free the whole way. If it helped you land this, tell us how it went; it is the best thing we
            can hear.
          </p>
          <Button asChild variant="outline" className="mt-3 w-full sm:w-auto">
            <Link data-testid="landed-pledge-tell" href="/contact?from=/yours">Tell us how it went</Link>
          </Button>
        </>
      )}
    </div>
  );
}

/** The panel for a pursuit, or nothing until it sits in the Offer lane.
 *  Reads the link from the /yours layout's provider, so the tracker page
 *  and the full pursuit page render it the same way. */
export function LandedPledgeForPursuit({ pursuit }: { pursuit: Pick<Pursuit, "status" | "job_id"> }) {
  const pledgeUrl = usePledgeUrl();
  if (boardColumn(pursuit) !== "offer") return null;
  return <LandedPledgePanel pledgeUrl={pledgeUrl} jobId={pursuit.job_id ?? null} />;
}

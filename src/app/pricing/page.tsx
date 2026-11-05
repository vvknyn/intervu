import type { Metadata } from "next";
import { connection } from "next/server";
import { PricingClient } from "./pricing-client";
import { pricingDescription } from "./offer";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getServerUser } from "@/lib/auth/server-user";
import { paidSummary } from "@/lib/billing/access";
import { isAutoRenewConfigured, isBillingConfigured } from "@/lib/billing/config";
import { readProfile } from "@/lib/billing/profile-store";

const TITLE = "Pricing";

// The description follows the billing switch, which is server env read per request (the page is dynamic).
export function generateMetadata(): Metadata {
  const description = pricingDescription(isAutoRenewConfigured());
  return { description, ...canonicalMetadata("/pricing", TITLE, description) };
}

/**
 * /pricing: one card. Server shell so the billing switch (server-only env)
 * and the signed-in account's paid-until date are resolved per request and
 * handed down as props; `PricingClient` owns the picker and the Buy call.
 */
export default async function PricingPage() {
  await connection();
  const user = await getServerUser();
  // A failed read must not 500 the page that sells the month: say so, keep buying open.
  let paidUntil: number | null = null;
  let autoRenewing = false;
  let paidStatusUnknown = false;
  if (user) {
    try {
      ({ paidUntil, autoRenewing } = paidSummary(await readProfile(user.uid)));
    } catch {
      paidStatusUnknown = true;
    }
  }
  return (
    <PricingClient
      signedIn={Boolean(user)}
      billingConfigured={isBillingConfigured()}
      autoRenewConfigured={isAutoRenewConfigured()}
      autoRenewing={autoRenewing}
      paidUntil={paidUntil}
      paidStatusUnknown={paidStatusUnknown}
    />
  );
}

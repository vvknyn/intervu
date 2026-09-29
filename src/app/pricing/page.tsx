import type { Metadata } from "next";
import { PricingClient } from "./pricing-client";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getServerUser } from "@/lib/auth/server-user";
import {
  FOUNDING_CHECKOUT_URL_ENV,
  foundingCheckoutUrl,
  paidCheckoutSessionId,
} from "@/lib/billing/founding-offer";

const TITLE = "Pricing";
const DESCRIPTION =
  "Velai is free to use. Pro and a Data API are coming; founding seats are open now at a one-off price.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/pricing", TITLE, DESCRIPTION),
};

/**
 * /pricing — the willingness-to-pay test. Three columns (Free, Pro, Data
 * API), one real button: a founding seat sold through a Stripe Payment Link
 * (lib/billing/founding-offer.ts). Nothing here gates a feature — Free is
 * today's product at today's limits, and Pro is a promise with a price on
 * it, which is the point: the page exists to measure who clicks a price
 * before anything is built behind it.
 *
 * Server shell so the checkout URL (a server-only env var, never inlined
 * into the client bundle) and the signed-in identity are resolved here and
 * handed down as props; `PricingClient` owns the analytics and the copy.
 * `searchParams` is the Stripe return (`?checkout=success&session_id=…`),
 * read once here so the client never has to parse the URL itself.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[]; session_id?: string | string[] }>;
}) {
  const [user, params] = await Promise.all([getServerUser(), searchParams]);
  const checkoutUrl = foundingCheckoutUrl(
    process.env[FOUNDING_CHECKOUT_URL_ENV],
    user ? { uid: user.uid, email: user.email } : null,
  );
  return (
    <PricingClient signedIn={Boolean(user)} checkoutUrl={checkoutUrl} paidSessionId={paidCheckoutSessionId(params)} />
  );
}

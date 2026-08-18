import type { Metadata } from "next";
import { buildPricingTiers } from "@/app/pricing/pricing-tiers";
import { PricingCard } from "@/app/pricing/PricingCard";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { DAILY_APPLY_CAP } from "@/lib/pursuits/apply-cap";
import { getMarketingStatsAction } from "@/actions/marketing";

const TITLE = "Pricing";
const DESCRIPTION = `Free while intervu is in beta. No card required — up to ${DAILY_APPLY_CAP} tracked applications a day.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/pricing", TITLE, DESCRIPTION),
};

export default async function PricingPage() {
  // Same live count TopBar's ticker renders — sourced once here (this page
  // is a Server Component, no client round trip needed) so the corpus size
  // can't go stale or disagree with the rest of the site.
  const stats = await getMarketingStatsAction();
  const tiers = buildPricingTiers(stats);

  return (
    <main data-testid="pricing-page" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">Free while we&apos;re in beta.</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Everything below, no card required. Paid truth tiers come later.
        </p>
      </header>

      <section className="mt-8 flex justify-center">
        <div className="w-full max-w-sm">
          {tiers.map((tier) => (
            <PricingCard key={tier.name} tier={tier} />
          ))}
        </div>
      </section>
    </main>
  );
}

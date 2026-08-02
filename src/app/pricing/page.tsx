import type { Metadata } from "next";
import { PRICING_TIERS } from "@/app/pricing/pricing-tiers";
import { PricingCard } from "@/app/pricing/PricingCard";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free while intervu is in beta. No card required — up to 20 applications a day.",
};

export default function PricingPage() {
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
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.name} tier={tier} />
          ))}
        </div>
      </section>

      <div className="mt-10 flex items-center justify-center gap-2.5 font-mono text-[13px] text-muted-foreground">
        <span className="h-[9px] w-[9px] bg-brand" aria-hidden />
        20 applications a day, on us
      </div>
    </main>
  );
}

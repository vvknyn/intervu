import type { Metadata } from "next";
import { PRICING_TIERS } from "@/app/pricing/pricing-tiers";
import { PricingCard } from "@/app/pricing/PricingCard";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Your AI does the thinking, free, over MCP. intervu only charges for verified corpus truth — jobs, watched companies, and real signals.",
};

export default function PricingPage() {
  return (
    <main data-testid="pricing-page" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">
          No subscription. Not even for the robots.
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Your AI brings the intelligence. What&apos;s metered here is the truth — verified jobs, watched companies,
          real signals.
        </p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING_TIERS.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </section>

      <div className="mt-10 flex items-center gap-2.5 font-mono text-[13px] text-muted-foreground">
        <span className="h-[9px] w-[9px] bg-brand" aria-hidden />
        the MCP server is free — what&apos;s metered is the truth
      </div>
    </main>
  );
}

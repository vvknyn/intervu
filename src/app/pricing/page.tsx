import type { Metadata } from "next";
import { PACKS, costPerApplication } from "@/lib/pricing";
import { PricingCard } from "@/app/pricing/PricingCard";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "No subscription — buy credits when you're hunting. Search and truth signals stay free; credits cover tailored resumes, fit checks, and interview prep.",
};

// One line each, no CTA — this is the existing free product, not a pack.
const FREE_FEATURES = [
  "Search every job we verify",
  "Full truth signals on every listing — ghost-risk flags, freshness, verified source",
  "Application tracker",
  "Resume builder",
  "~20 starter credits to try tailoring and fit checks",
];

export default function PricingPage() {
  const cost = costPerApplication();

  return (
    <main data-testid="pricing-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">
          No subscription. Buy credits when you&apos;re hunting.
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A serious application — tailored resume plus fit check — costs about {cost}.
        </p>
      </header>

      <section className="mt-8 border-t border-foreground pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Free, always</h2>
        <p className="mt-3 text-sm leading-loose text-foreground">{FREE_FEATURES.join(" · ")}</p>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Credit packs</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PACKS.map((pack) => (
            <PricingCard key={pack.id} pack={pack} />
          ))}
        </div>
      </section>
    </main>
  );
}

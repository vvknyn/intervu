import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PricingBullet, PricingCta, PricingTier } from "@/app/pricing/pricing-tiers";

/** A bullet is a link when the tier data gives it an `href` (e.g. "Connect
 *  your AI (MCP)" -> /connect) — one branch, driven by data, not a second
 *  hand-written bullet list per tier. */
function TierBullet({ bullet }: { bullet: PricingBullet }) {
  return (
    <li className="flex gap-2 text-sm leading-snug text-foreground">
      <span className="mt-[7px] h-[5px] w-[5px] shrink-0 bg-foreground/40" aria-hidden />
      {bullet.href ? (
        <Link href={bullet.href} className="underline underline-offset-2 hover:text-brand">
          {bullet.text}
        </Link>
      ) : (
        <span>{bullet.text}</span>
      )}
    </li>
  );
}

/** Renders the tier's CTA from its `cta` union: a disabled hairline button
 *  for paid-but-unwired tiers, or a Button-wrapped link (internal `Link` vs.
 *  external `<a target="_blank">`, decided by the href itself — no separate
 *  "external" flag to keep in sync). */
function TierCta({ cta }: { cta: PricingCta }) {
  if (cta.kind === "disabled") {
    return (
      <Button type="button" variant={cta.variant} disabled className="w-full justify-center">
        {cta.label}
      </Button>
    );
  }

  const isExternal = cta.href.startsWith("http");
  return (
    <Button asChild variant={cta.variant} className="w-full justify-center">
      {isExternal ? (
        <a href={cta.href} target="_blank" rel="noopener">
          {cta.label}
        </a>
      ) : (
        <Link href={cta.href}>{cta.label}</Link>
      )}
    </Button>
  );
}

export function PricingCard({ tier }: { tier: PricingTier }) {
  const highlighted = Boolean(tier.highlight);

  return (
    <div
      data-testid={`pricing-card-${tier.name.toLowerCase()}`}
      className={cn(
        "relative flex flex-col gap-4 rounded-none p-6 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        highlighted ? "border-2 border-foreground bg-card/90" : "border border-border/80 bg-card/75",
      )}
    >
      {tier.highlight && (
        <span className="absolute -top-3 left-[18px] rounded-none bg-brand px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase leading-none tracking-widest text-brand-foreground">
          {tier.highlight}
        </span>
      )}

      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {tier.name}
        </p>
        <p className="mt-1.5 font-mono text-[32px] font-medium leading-none text-foreground">{tier.price}</p>
        <p className="mt-2 text-sm text-muted-foreground">{tier.tagline}</p>
      </div>

      <ul className="flex flex-col gap-1.5 border-t border-foreground/10 pt-4">
        {tier.carriesFrom && (
          <li className="text-sm font-medium text-foreground">Everything in {tier.carriesFrom}, plus:</li>
        )}
        {tier.bullets.map((bullet) => (
          <TierBullet key={bullet.text} bullet={bullet} />
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-3">
        <p className="text-xs italic text-muted-foreground">{tier.priceNote}</p>
        <TierCta cta={tier.cta} />
      </div>
    </div>
  );
}

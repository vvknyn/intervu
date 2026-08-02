/**
 * Single source of truth for the /pricing ladder (v2 — "your AI thinks for
 * free, we only meter corpus truth"). One array, rendered via `.map()` in
 * `page.tsx` — a 5th tier is one entry here, never a hand-copied JSX block.
 *
 * Replaces the v1 "AI-feature credit packs" framing (`src/lib/pricing.ts`,
 * `src/lib/llm/credit-gate.ts` — untouched, still power other surfaces).
 * Credits here mean truth-units only: verified jobs, watches, history pulls —
 * never AI/LLM actions, which are free and run through the user's own MCP key.
 */

export interface PricingBullet {
  text: string;
  /** Set only when the bullet itself should be a link (e.g. "Connect your AI (MCP)" -> /connect). */
  href?: string;
}

export type PricingCta =
  | { kind: "link"; label: string; href: string; variant: "default" | "outline" | "quiet" }
  | { kind: "disabled"; label: string; variant: "quiet" };

export interface PricingTier {
  name: string;
  /** The literal price slot — a dollar figure, a unit ("credits/week"), or "let's talk". Always rendered font-mono. */
  price: string;
  /** Short phrase under the price describing what it buys. */
  tagline: string;
  /** Small note near the CTA explaining what the price/credits mean. */
  priceNote: string;
  /** Prior tier name this one carries forward, so bullet copy isn't duplicated tier to tier. */
  carriesFrom?: string;
  bullets: PricingBullet[];
  cta: PricingCta;
  /** Callout tag text (e.g. "Serious hunts") for the one tier meant to be visually promoted. */
  highlight?: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    name: "Looking",
    price: "$0",
    tagline: "the hunt itself — and the thinking",
    priceNote: "intelligence is free — yours or ours",
    bullets: [
      { text: "Search + every truth signal" },
      { text: "Tracker · resume builder · prep" },
      { text: "Tailoring & fit checks" },
      { text: "Connect your AI (MCP) · personal key, daily quota", href: "/connect" },
    ],
    cta: { kind: "link", label: "Start free", href: "/", variant: "default" },
  },
  {
    name: "Hunting",
    price: "$5–19",
    tagline: "one-time truth packs · never expire",
    priceNote: "credits = units of truth",
    carriesFrom: "Looking",
    bullets: [
      { text: "Deep history pulls · reposts, closures" },
      { text: "Bulk verify · “which are live?”" },
      { text: "High-volume MCP calls" },
    ],
    cta: { kind: "disabled", label: "Get credits — coming in beta", variant: "quiet" },
    highlight: "Serious hunts",
  },
  {
    name: "Watching",
    price: "credits/week",
    tagline: "standing watches · ~1–2 credits per watch per week",
    priceNote: "pause any time · no subscription to cancel",
    carriesFrom: "Hunting",
    bullets: [
      { text: "Watch companies & roles" },
      { text: "Your AI gets pinged via MCP" },
      { text: "Email alerts, verified-only" },
    ],
    cta: { kind: "disabled", label: "Start watching — coming in beta", variant: "quiet" },
  },
  {
    name: "Building",
    price: "let's talk",
    tagline: "commercial API · the Subspace corpus",
    priceNote: "data by Subspace",
    bullets: [
      { text: "Commercial MCP/API keys" },
      { text: "Per-call licensing" },
      { text: "Bulk quotas · SLA" },
      { text: "Build your own job product" },
    ],
    cta: { kind: "link", label: "Contact us", href: "https://thesubspace.io", variant: "outline" },
  },
];

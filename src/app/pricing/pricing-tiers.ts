/**
 * Single source of truth for the /pricing ladder (v3 — free-only launch,
 * product decision 2026-08-02). One array, rendered via `.map()` in
 * `page.tsx` — a future paid tier is one entry here, never a hand-copied JSX
 * block. `PricingTier`'s `carriesFrom`/`highlight` are unused by the single
 * tier below but kept on the type: paid truth tiers come back later (see
 * /pricing's own copy), not a hypothetical.
 *
 * Replaces the v1 "AI-feature credit packs" framing (`src/lib/pricing.ts`,
 * `src/lib/llm/credit-gate.ts` — still power other surfaces) and the v2
 * 4-tier ladder. Interview prep (recon/match/questions), tailoring, fit
 * checks, and cover-letter generation are NOT implemented anywhere a user
 * can reach — not as an in-app action, not as an MCP tool. The MCP registry
 * (`src/app/api/mcp/route.ts`) exposes exactly 11 tools, all of them job
 * search/save, application tracking, and résumé read/write; there is no
 * prep/fit/tailoring/cover-letter tool among them. `/prep` redirects to
 * `/jobs` (2026-08-02). This copy must not claim that suite exists in any
 * framing ("MCP-only", "coming soon") until the code does — say plainly that
 * it's unimplemented rather than gating the claim behind vaguer language.
 * The web app's own built-in AI (the shared-key credit gate below)
 * currently powers exactly four reachable, coin-spending actions: résumé-based
 * job ranking on `/jobs` ("Rank my jobs" — `ResumeImportModal` →
 * `parseResumeWithAI`), story import from pasted text (`StoryImportModal` →
 * `parseStoriesFromText`), story extraction from an uploaded document
 * (`StoryEditorWizard` → `convertBlobToStar`), and AI-drafted interview
 * questions (`AddQuestionModal` → `addInterviewQuestion`). The credit amounts
 * are read from `credit-gate.ts` and the unit noun from `credit-copy.ts`
 * rather than retyped, so this copy can't drift from what's actually charged
 * or from what the sidebar balance calls it (it said "coins" here and
 * "credits" everywhere else until 2026-08-18). Same reasoning for the
 * corpus-size bullet: it reads the live count off the same
 * `getMarketingStatsAction`/`formatCorpusCount` source the landing page's
 * ticker uses (`TopBar.tsx`), rather than a hand-typed figure that can go
 * stale as the corpus grows and disagree with what the rest of the site says.
 * Any bullet claiming an AI capability should set `PricingBullet.backedBy`
 * to the module/symbol that implements it — `tests/unit/pricing.test.ts`
 * asserts that symbol is a real, reachable export, which is the guard that
 * would have caught the "fit, tailoring, prep" bullet this file used to ship.
 */
import { MONTHLY_FREE_CREDITS, CREDITS_PER_ACTION, WELCOME_CREDITS } from "@/lib/llm/credit-gate";
import { BETA_UNLIMITED_CREDITS, CREDIT_UNIT, creditCount } from "@/lib/llm/credit-copy";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketingCorpusStats } from "@/lib/marketing-stats";

export interface PricingBullet {
  text: string;
  /** Set only when the bullet itself should be a link (e.g. "Connect your AI (MCP)" -> /connect). */
  href?: string;
  /**
   * Set when `text` claims the app (or the user's own AI via MCP) can DO
   * something — the module/symbol that actually implements it.
   * `tests/unit/pricing.test.ts` asserts the symbol is a real export of
   * `module` AND is actually imported somewhere under src/app or
   * src/components (not just present in the file, i.e. not dead code). A
   * bullet with no `backedBy` makes no code claim and isn't checked.
   */
  backedBy?: { module: string; symbol: string };
}

export type PricingCta =
  | { kind: "link"; label: string; href: string; variant: "default" | "outline" | "quiet" | "brand" }
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

/**
 * Build the tier ladder for a given corpus reading. `stats` is the same
 * `MarketingCorpusStats | null` shape `getMarketingStatsAction` returns —
 * `null` when the count genuinely isn't available (e.g. the index is down),
 * in which case the bullet drops the number rather than showing a stale or
 * fabricated one (same degrade rule `marketingClaim` uses for the landing
 * claim).
 */
export function buildPricingTiers(stats: MarketingCorpusStats | null): PricingTier[] {
  return [
    {
      name: "Free",
      price: "$0",
      tagline: "the whole product",
      priceNote: "No card required. Nothing to cancel.",
      bullets: [
        {
          text: stats
            ? `Search ${formatCorpusCount(stats.liveJobs)} live jobs, straight from companies' own career pages`
            : "Search live jobs, straight from companies' own career pages",
        },
        { text: "A posting check on every role — actively posted, worth verifying, or possibly stale" },
        { text: "Track every application in one place, from interested to offer" },
        // The AI-allowance line is chosen by the same constant the gate reads
        // (`BETA_UNLIMITED_CREDITS`, ./credit-copy.ts), never written by hand:
        // during beta `chargeIfSharedKey` short-circuits above `consumeCredit`,
        // so quoting a monthly figure or a sign-up grant here would describe an
        // economy nothing is running. Both arms stay so the flip is one commit.
        ...(BETA_UNLIMITED_CREDITS
          ? [{ text: "Unlimited AI actions while we're in beta — no limit to run into" }]
          : [
              {
                text: `${MONTHLY_FREE_CREDITS} free ${CREDIT_UNIT.many} every month for AI actions — ${creditCount(CREDITS_PER_ACTION)} per action, refilled on the 1st`,
              },
              {
                text: `Plus ${creditCount(WELCOME_CREDITS)} when you sign up, which never expire`,
              },
            ]),
        {
          text: "For example: rank your job list against your résumé, import your stories from pasted text, turn a rough note into a full story, or draft an interview question",
          backedBy: { module: "src/actions/resume.ts", symbol: "parseResumeWithAI" },
        },
        {
          // Distinct from the "Connect your own AI" bullet below, which is
          // MCP — your chat assistant driving intervu. This one is BYOK: your
          // provider key powering intervu's own AI actions. Two features, and
          // the near-identical names are why the copy spells out which is
          // which rather than leaning on "your own AI".
          // Deliberately avoids the phrase "AI action": tests/unit/pricing.test.ts
          // locates the one allowance bullet with /AI action/i, and a second
          // match would make that locator — and every assertion hanging off
          // it — ambiguous. "those" refers to the examples in the bullet above.
          text: "Or run those on your own provider account instead — add an OpenRouter or Groq key in Settings and they go through your key, not ours",
          backedBy: { module: "src/actions/profile.ts", symbol: "saveProviderApiKey" },
        },
        {
          text: "Drive intervu from your own AI chat — search and save jobs, track applications, and update your résumé without leaving the conversation",
          href: "/connect",
          backedBy: { module: "src/lib/agent/tools.ts", symbol: "toolSearchJobs" },
        },
      ],
      cta: { kind: "link", label: "Start free", href: "/", variant: "brand" },
    },
  ];
}

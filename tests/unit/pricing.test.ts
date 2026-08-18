import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PACKS } from "@/lib/pricing";
import { MONTHLY_FREE_CREDITS, CREDITS_PER_ACTION } from "@/lib/llm/credit-gate";
import { DAILY_APPLY_CAP } from "@/lib/pursuits/apply-cap";
import { buildPricingTiers } from "@/app/pricing/pricing-tiers";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";

describe("PACKS shape", () => {
  it("every pack id is unique", () => {
    const ids = PACKS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every pack has a positive price and credit amount", () => {
    for (const pack of PACKS) {
      assert.ok(pack.usd > 0, `${pack.id} has a non-positive usd`);
      assert.ok(pack.credits > 0, `${pack.id} has a non-positive credit amount`);
    }
  });
});

// Regression coverage for the copy-drift bug: /pricing used to hand-type
// numbers (free-credit count, apply cap) that could silently disagree with
// what the app actually enforces. These assert the rendered bullet text is
// composed FROM the enforcing constants, not a re-typed literal — so a
// future change to any of the three constants is guaranteed to move the
// copy, the same class of fix as the coins bullet that motivated this.
describe("/pricing copy derives from the constants it describes", () => {
  const bulletTexts = buildPricingTiers(null).flatMap((tier) => tier.bullets.map((b) => b.text));

  it("states the real monthly coin allowance and per-action cost, not a hardcoded pair", () => {
    const coinsBullet = bulletTexts.find((t) => t.includes("coin"));
    assert.ok(coinsBullet, "expected a bullet mentioning coins");
    assert.match(coinsBullet!, new RegExp(String(MONTHLY_FREE_CREDITS)));
    assert.match(coinsBullet!, new RegExp(`${CREDITS_PER_ACTION} coin per AI action`));
  });

  it("states the real daily apply cap, not a hardcoded literal", () => {
    const capBullet = bulletTexts.find((t) => t.includes("tracked applications a day"));
    assert.ok(capBullet, "expected the daily-apply-cap bullet");
    assert.match(capBullet!, new RegExp(String(DAILY_APPLY_CAP)));
  });

  it("never advertises prep or cover-letter generation as example actions (MCP-only, not coin-billed)", () => {
    const coinsBullet = bulletTexts.find((t) => t.includes("coin"))!;
    assert.doesNotMatch(coinsBullet, /\bprep\b/i);
    assert.doesNotMatch(coinsBullet, /cover letter/i);
  });
});

describe("/pricing corpus-count bullet derives from the same source as the rest of the site", () => {
  it("renders the live count via formatCorpusCount when stats are available", () => {
    const stats = { liveJobs: { kind: "exact" as const, value: 2_060_299 } };
    const bullet = buildPricingTiers(stats).flatMap((t) => t.bullets).find((b) => b.text.startsWith("Search "));
    assert.ok(bullet);
    assert.equal(bullet!.text, `Search ${formatCorpusCount(stats.liveJobs)} live verified jobs`);
    assert.match(bullet!.text, /2,060,299/);
  });

  it("degrades to a count-free claim (never a stale or fabricated number) when stats are unavailable", () => {
    const bullet = buildPricingTiers(null).flatMap((t) => t.bullets).find((b) => b.text.startsWith("Search "));
    assert.ok(bullet);
    assert.equal(bullet!.text, "Search live verified jobs");
    assert.doesNotMatch(bullet!.text, /\d/);
  });
});

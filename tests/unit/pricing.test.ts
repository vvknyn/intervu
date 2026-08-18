import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PACKS } from "@/lib/pricing";
import { MONTHLY_FREE_CREDITS, CREDITS_PER_ACTION } from "@/lib/llm/credit-gate";
import { DAILY_APPLY_CAP } from "@/lib/pursuits/apply-cap";
import { buildPricingTiers, type PricingBullet } from "@/app/pricing/pricing-tiers";
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

// Guard for the class of bug that shipped "Connect your AI — fit, tailoring,
// prep run in YOUR AI": a bullet asserting an AI capability that no code
// path actually reaches. Rather than a blocklist of invented-feature words
// (which only catches the NEXT bullet if it happens to reuse one of today's
// words), any bullet claiming a capability declares `backedBy: { module,
// symbol }`, and this checks that symbol is (a) a real export of that
// module and (b) actually imported by app/UI code — not merely present in
// its own file, which is exactly the shape of a dead, unreachable export.
const REPO_ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function exportsSymbol(module: string, symbol: string): boolean {
  const src = readFileSync(join(REPO_ROOT, module), "utf8");
  return (
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`).test(src) ||
    new RegExp(`export\\s+(?:const|class|interface|type)\\s+${symbol}\\b`).test(src) ||
    new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`).test(src)
  );
}

/** Whole-word import of `symbol` from an `import { ... } from ...` list, in
 * any file under src/app or src/components other than the module itself —
 * i.e. genuinely wired into the app, not just declared. */
function isImportedUnderAppOrComponents(module: string, symbol: string): boolean {
  const modulePath = join(REPO_ROOT, module);
  const importRe = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from`);
  for (const dir of ["app", "components"]) {
    for (const file of sourceFiles(join(REPO_ROOT, "src", dir))) {
      if (file === modulePath) continue;
      if (importRe.test(readFileSync(file, "utf8"))) return true;
    }
  }
  return false;
}

describe("pricing bullets that claim an AI capability point at reachable code", () => {
  const claims = buildPricingTiers(null)
    .flatMap((tier) => tier.bullets)
    .filter((b): b is PricingBullet & { backedBy: NonNullable<PricingBullet["backedBy"]> } => !!b.backedBy);

  it("has at least one bullet declaring backedBy (guard isn't vacuous)", () => {
    assert.ok(claims.length > 0, "expected the /connect bullet to declare backedBy");
  });

  it("every backedBy claim in the live pricing copy names a real, reachable export", () => {
    for (const bullet of claims) {
      const { module, symbol } = bullet.backedBy;
      assert.ok(exportsSymbol(module, symbol), `${module} does not export ${symbol} (bullet: "${bullet.text}")`);
      assert.ok(
        isImportedUnderAppOrComponents(module, symbol),
        `${symbol} from ${module} is never imported under src/app or src/components — "${bullet.text}" claims an unreachable capability`,
      );
    }
  });

  // Non-motivating case: a fabricated capability must fail this guard the
  // same way "fit, tailoring, prep" should have. `generateCoverLetter` is a
  // real, exported function (src/actions/cover-letter.ts) — it just has zero
  // importers outside its own file, so nothing in the app can ever reach it.
  it("rejects a bullet that cites a real but dead export as its backing", () => {
    const fabricated: PricingBullet["backedBy"] = {
      module: "src/actions/cover-letter.ts",
      symbol: "generateCoverLetter",
    };
    assert.ok(exportsSymbol(fabricated!.module, fabricated!.symbol), "sanity: generateCoverLetter must actually exist for this case to prove anything");
    assert.equal(
      isImportedUnderAppOrComponents(fabricated!.module, fabricated!.symbol),
      false,
      "generateCoverLetter is now reachable from the app — this fixture no longer represents a dead export and should be replaced",
    );
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

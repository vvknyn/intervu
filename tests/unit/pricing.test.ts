import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PACKS } from "@/lib/pricing";
import { MONTHLY_FREE_CREDITS, CREDITS_PER_ACTION, WELCOME_CREDITS } from "@/lib/llm/credit-gate";
import { BETA_UNLIMITED_CREDITS, CREDIT_UNIT, creditCount } from "@/lib/llm/credit-copy";
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

  // Whichever arm is live, exactly one bullet describes what an AI action
  // costs. Found by what it is ABOUT, not by a phrase unique to one arm, so
  // the same assertions keep pointing at the right line across the flip.
  const aiBullet = bulletTexts.find((t) => /AI action/i.test(t));

  it("has exactly one bullet describing the AI allowance", () => {
    assert.equal(bulletTexts.filter((t) => /AI action/i.test(t)).length, 1, bulletTexts.join("\n"));
  });

  it("never advertises prep or cover-letter generation as example actions (MCP-only, not credit-billed)", () => {
    assert.doesNotMatch(aiBullet!, /\bprep\b/i);
    assert.doesNotMatch(aiBullet!, /cover letter/i);
  });

  if (BETA_UNLIMITED_CREDITS) {
    // Beta (2026-08-18): `chargeIfSharedKey` short-circuits above
    // `consumeCredit`, so ANY quantity on this page describes an economy
    // nothing is running. The monthly figure and the sign-up grant are the
    // two that were live here the morning the switch went in.
    it("says AI is unlimited during the beta the gate is actually in", () => {
      assert.ok(aiBullet, "expected a bullet describing the AI allowance");
      assert.match(aiBullet!, /unlimited/i);
      assert.match(aiBullet!, /beta/i);
    });

    it("quotes no credit quantity anywhere while nothing is metered", () => {
      for (const text of bulletTexts) {
        assert.doesNotMatch(text, /\d+\s+credits?\b/i, text);
        assert.doesNotMatch(text, new RegExp(`\\b${MONTHLY_FREE_CREDITS}\\b`), text);
        assert.doesNotMatch(text, new RegExp(`\\b${WELCOME_CREDITS}\\b`), text);
      }
    });
  } else {
    it("states the real monthly allowance and per-action cost, not a hardcoded pair", () => {
      assert.ok(aiBullet, "expected a bullet stating the monthly allowance");
      assert.ok(aiBullet!.includes(`${MONTHLY_FREE_CREDITS} free ${CREDIT_UNIT.many}`), aiBullet);
      assert.ok(aiBullet!.includes(creditCount(CREDITS_PER_ACTION)), aiBullet);
    });

    // Non-motivating case: the one-time sign-up grant is a THIRD constant
    // (WELCOME_CREDITS, granted by `grantWelcomeCredits` on first sign-in) that
    // would drift independently of the monthly pair the test above covers.
    it("states the sign-up grant from WELCOME_CREDITS, not a re-typed figure", () => {
      const grantBullet = bulletTexts.find((t) => t.startsWith("Plus "));
      assert.ok(grantBullet, "expected a bullet naming the sign-up grant");
      assert.ok(grantBullet!.includes(creditCount(WELCOME_CREDITS)), grantBullet);
    });

    it("does not still advertise the beta's unlimited AI once metering is back on", () => {
      for (const text of bulletTexts) assert.doesNotMatch(text, /unlimited/i, text);
    });
  }

  // The four real coin-spending actions must read as plain human capability
  // descriptions, never as the implementation symbols that back them —
  // leaking function/component names into marketing copy is the kind of
  // thing a nurse reading this page shouldn't have to parse.
  it("names the four coin-spending actions in plain language, not implementation symbols", () => {
    const exampleBullet = bulletTexts.find((t) => t.startsWith("For example:"));
    assert.ok(exampleBullet, "expected a bullet naming example AI actions");
    for (const symbol of ["parseResumeWithAI", "parseStoriesFromText", "convertBlobToStar", "addInterviewQuestion"]) {
      assert.doesNotMatch(exampleBullet!, new RegExp(symbol));
    }
    assert.match(exampleBullet!, /résumé/i);
    assert.match(exampleBullet!, /interview question/i);
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
  // Asserts the COMPOSITION (count formatted by the shared helper), not the
  // whole sentence — an exact-string assertion breaks on every wording edit
  // and teaches people to delete the test rather than read it.
  it("renders the live count via formatCorpusCount when stats are available", () => {
    const stats = { liveJobs: { kind: "exact" as const, value: 2_060_299 } };
    const bullet = buildPricingTiers(stats).flatMap((t) => t.bullets).find((b) => b.text.startsWith("Search "));
    assert.ok(bullet);
    assert.ok(bullet!.text.includes(formatCorpusCount(stats.liveJobs)), bullet!.text);
    assert.match(bullet!.text, /2,060,299/);
  });

  it("degrades to a count-free claim (never a stale or fabricated number) when stats are unavailable", () => {
    const bullet = buildPricingTiers(null).flatMap((t) => t.bullets).find((b) => b.text.startsWith("Search "));
    assert.ok(bullet);
    assert.doesNotMatch(bullet!.text, /\d/, bullet!.text);
  });
});

// The /pricing page and the balance a user actually sees must name the AI
// unit with the same word. They didn't: this page said "coins" while the
// sidebar said "40 credits", the out-of-credits block said "credits", and
// /terms had a "Credits" heading — one product, two nouns, and the page whose
// whole job is explaining the economy was the one using the word that appears
// nowhere else. Both now compose from `CREDIT_UNIT`/`creditCount`
// (lib/llm/credit-copy.ts), which is a pure module precisely so the "use
// client" sidebar can read it without pulling firebase-admin in.
describe("the AI unit has exactly one user-facing name", () => {
  const bulletTexts = buildPricingTiers(null).flatMap((tier) => tier.bullets.map((b) => b.text));

  it("no /pricing bullet uses the retired 'coin' vocabulary", () => {
    for (const text of bulletTexts) assert.doesNotMatch(text, /\bcoins?\b/i, text);
  });

  it("the sidebar balance takes its noun from the shared export, not a hand-typed plural", () => {
    const balance = readFileSync(join(REPO_ROOT, "src/components/layout/CreditBalance.tsx"), "utf8");
    assert.match(balance, /from "@\/lib\/llm\/credit-copy"/);
    // The exact shape this replaced: `${s.total} credit${s.total === 1 ? "" : "s"}`.
    assert.doesNotMatch(balance, /credit\$\{/);
  });

  it("creditCount pluralizes from the one noun (guard isn't vacuous)", () => {
    assert.equal(creditCount(1), `1 ${CREDIT_UNIT.one}`);
    assert.equal(creditCount(0), `0 ${CREDIT_UNIT.many}`);
    assert.equal(creditCount(MONTHLY_FREE_CREDITS), `${MONTHLY_FREE_CREDITS} ${CREDIT_UNIT.many}`);
  });
});

// The free plan advertised "Up to 20 tracked applications a day" and the app
// enforced it (`assertUnderDailyApplyCap`, removed 2026-08-18). Copy and
// enforcement are two halves of one promise and the dangerous states are the
// mismatched ones — a cap enforced but undisclosed surprises a user mid-flow,
// a cap advertised but unenforced is a lie. Both halves are gone; this fails
// if either comes back alone.
describe("no daily application limit is advertised or enforced", () => {
  it("no pricing bullet claims a per-day allowance", () => {
    for (const text of buildPricingTiers(null).flatMap((t) => t.bullets.map((b) => b.text))) {
      assert.doesNotMatch(text, /\b(a|per)\s+day\b/i, text);
    }
  });

  it("no source file enforces a daily apply cap", () => {
    const offenders = sourceFiles(join(REPO_ROOT, "src")).filter((f) =>
      /DAILY_APPLY_CAP|assertUnderDailyApplyCap|pursuits\/apply-cap/.test(readFileSync(f, "utf8")),
    );
    assert.deepEqual(offenders, [], "daily apply cap enforcement is back but /pricing does not disclose it");
  });
});

// Metering and the copy describing it are two halves of one promise, and the
// dangerous states are the mismatched ones — charging while /pricing says
// "unlimited" is a lie, and advertising credits nothing spends is the bug
// this file's whole history is made of (the coins/credits split, the daily
// apply cap). `BETA_UNLIMITED_CREDITS` exists so one edit moves both halves.
// These fail if a surface starts quoting the economy without reading it.
describe("the beta switch drives enforcement and disclosure together", () => {
  const read = (module: string) => readFileSync(join(REPO_ROOT, module), "utf8");
  const SWITCH = "BETA_UNLIMITED_CREDITS";

  it("the charge path reads the same switch the copy does", () => {
    const gate = read("src/lib/llm/credit-gate.ts");
    assert.match(gate, new RegExp(`import\\s*\\{[^}]*\\b${SWITCH}\\b[^}]*\\}\\s*from\\s*"@/lib/llm/credit-copy"`));
    // Non-vacuous: importing it isn't enough — it has to gate the spend.
    const charge = gate.slice(gate.indexOf("export async function chargeIfSharedKey"));
    assert.ok(charge.includes(SWITCH), "chargeIfSharedKey does not consult the switch");
    assert.ok(charge.indexOf(SWITCH) < charge.indexOf("consumeCredit("), "the switch must be read BEFORE the spend");
  });

  // Class-wide rather than a list of today's pages: any RENDERING file that
  // quotes a credit figure has to acknowledge whether that figure is
  // currently being charged. A new surface reaching for
  // `MONTHLY_FREE_CREDITS` without reading the switch is exactly the drift
  // this catches.
  //
  // Scoped to src/app + src/components — the layers that put words in front
  // of a user — for the same reason `isImportedUnderAppOrComponents` above
  // is. Whole-src caught `src/lib/pricing.ts`, which names
  // `CREDITS_PER_ACTION` only in a doc comment explaining where per-action
  // cost does NOT live: a data table, not a surface, and exempting it by
  // path would have been the enumeration this guard exists to avoid.
  it("every rendering file quoting a credit amount also reads the switch", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => sourceFiles(join(REPO_ROOT, "src", dir)))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return /MONTHLY_FREE_CREDITS|WELCOME_CREDITS|CREDITS_PER_ACTION/.test(src) && !src.includes(SWITCH);
      })
      .map((f) => f.slice(REPO_ROOT.length + 1));
    assert.deepEqual(offenders, [], "these render a credit amount without saying whether it is charged");
  });

  // Non-vacuous: the scan must actually be looking at files that mention the
  // constants, or an empty offender list proves nothing. /pricing is the page
  // the switch was introduced for, so it is the honest canary.
  it("the scan reaches at least one file that quotes a credit amount", () => {
    const scanned = ["app", "components"]
      .flatMap((dir) => sourceFiles(join(REPO_ROOT, "src", dir)))
      .filter((f) => /MONTHLY_FREE_CREDITS|WELCOME_CREDITS|CREDITS_PER_ACTION/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO_ROOT.length + 1));
    assert.ok(scanned.includes("src/app/pricing/pricing-tiers.ts"), scanned.join(", "));
  });

  it("/terms does not describe a prepaid economy while nothing is metered", () => {
    const terms = read("src/app/terms/page.tsx");
    assert.ok(terms.includes(SWITCH), "/terms states what credits cost — it must read the switch");
    if (BETA_UNLIMITED_CREDITS) {
      const beta = terms.slice(terms.indexOf(`{${SWITCH} ? (`), terms.indexOf(") : ("));
      assert.doesNotMatch(beta, /prepaid|non-refundable|packs?\b/i, beta);
    }
  });

  it("the sidebar indicator shows a state, not a balance that never moves", () => {
    const balance = read("src/components/layout/CreditBalance.tsx");
    assert.ok(balance.includes(SWITCH), "CreditBalance renders a credit total — it must read the switch");
    assert.ok(balance.indexOf(SWITCH) < balance.indexOf("s.isAdmin)"), "the beta branch must precede the account-kind branches");
  });
});

describe("every page that talks about credits reads the beta switch", () => {
  // The amount-quoting guard above misses prose that describes *metering*
  // without naming a number — which is exactly how /privacy kept promising to
  // "apply your credit balance when you use a paid feature" for a whole
  // release after /terms stopped saying anything was metered. Keying on the
  // word itself rather than on a list of phrases means a new page describing
  // a charge is covered the day it is written.
  const pages: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") pages.push(full);
    }
  })(join(process.cwd(), "src/app"));

  const mentionsCredits = pages.filter((f) => /credit/i.test(readFileSync(f, "utf8")));

  it("finds the pages that mention credits", () => {
    assert.ok(
      mentionsCredits.length >= 3,
      `only ${mentionsCredits.length} pages mention credits — the walk is not reaching src/app`,
    );
  });

  it("each of them imports BETA_UNLIMITED_CREDITS", () => {
    for (const f of mentionsCredits) {
      const rel = f.slice(f.indexOf("src/app"));
      assert.ok(
        readFileSync(f, "utf8").includes("BETA_UNLIMITED_CREDITS"),
        `${rel} describes credits but never reads the beta switch — it will keep ` +
          `describing a charge the product cannot levy once beta is on`,
      );
    }
  });
});

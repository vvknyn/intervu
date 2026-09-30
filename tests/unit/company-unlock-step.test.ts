import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { companyUnlockStep } from "../../src/lib/company/unlock-step";

/** The /co page's composed tree; page.tsx fetches and renders this. */
const CO_PAGE_BODY = join(__dirname, "..", "..", "src", "components", "company", "CompanyPageBody.tsx");
const EXHAUST_GATE = join(__dirname, "..", "..", "src", "components", "company", "CompanyExhaustGate.tsx");

describe("companyUnlockStep: the single next-step ask across every company-page gate", () => {
  it("anonymous (signed out, not following) -> sign-in", () => {
    assert.equal(companyUnlockStep({ signedIn: false, following: false }), "sign-in");
  });

  it("signed-in non-follower -> follow", () => {
    assert.equal(companyUnlockStep({ signedIn: true, following: false }), "follow");
  });

  it("a follower has nothing left to ask for, signed in or not", () => {
    assert.equal(companyUnlockStep({ signedIn: true, following: true }), null);
    assert.equal(companyUnlockStep({ signedIn: false, following: true }), null);
  });
});

/** The "cards to render" proof: since `companyUnlockStep` returns a single
 *  discriminated value, at most one of these two flags can ever be true —
 *  this makes that invariant explicit for each of the three visitor states
 *  instead of leaving it implicit in the return type. */
function cardsToRender(input: { signedIn: boolean; following: boolean }) {
  const step = companyUnlockStep(input);
  return { signInCard: step === "sign-in", followCard: step === "follow" };
}

describe("companyUnlockStep: exactly one card renders per visitor state", () => {
  it("anonymous sees exactly the sign-in card", () => {
    assert.deepEqual(cardsToRender({ signedIn: false, following: false }), {
      signInCard: true,
      followCard: false,
    });
  });

  it("signed-in non-follower sees exactly the follow card (the case the double-card bug did not cover)", () => {
    assert.deepEqual(cardsToRender({ signedIn: true, following: false }), {
      signInCard: false,
      followCard: true,
    });
  });

  it("a follower sees neither card", () => {
    assert.deepEqual(cardsToRender({ signedIn: true, following: true }), {
      signInCard: false,
      followCard: false,
    });
  });
});

describe("/co/[slug]: the main intel gate's card is routed through companyUnlockStep", () => {
  it("imports and calls companyUnlockStep to decide the main gate's fallback, rather than hardcoding it", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    assert.match(
      source,
      /import \{ companyUnlockStep \} from "@\/lib\/company\/unlock-step"/,
      "CompanyPageBody.tsx must import companyUnlockStep",
    );
    assert.match(
      source,
      /companyUnlockStep\(\{ signedIn, following: false \}\)/,
      "the main gate's fallback must be derived from companyUnlockStep",
    );
  });
});

describe("CompanyExhaustGate: the sign-in card names both what sign-in unlocks and what following adds", () => {
  it("mentions hiring history as what following additionally unlocks, alongside the full-record teasers", () => {
    const source = readFileSync(EXHAUST_GATE, "utf8");
    assert.match(source, /hiring history/i);
  });
});

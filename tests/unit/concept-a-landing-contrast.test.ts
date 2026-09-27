import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync("src/components/onboarding/ConceptALanding.tsx", "utf8");
const POSTCARD = SRC.match(/function PostcardCard[\s\S]*?^}/m)?.[0] ?? "";

test("Concept A postcard stack uses AA-safe live token and no cream text-live", () => {
  assert.ok(POSTCARD.length > 0, "PostcardCard block missing");
  assert.doesNotMatch(POSTCARD, /\btext-live\b/, "postcard stack must not use canvas live on cream");
  assert.match(POSTCARD, /bg-live-on-postcard/, "live dot uses postcard-safe fill");
});

test("Concept A poster copy sits on opaque surface-poster plates", () => {
  assert.match(SRC, /header className="[^"]*bg-surface-poster/);
  assert.match(SRC, /bg-surface-poster pt-6/, "hero column plate");
  assert.match(SRC, /flex w-fit flex-col gap-2 bg-surface-poster text-poster-hero/, "hero lines avoid overlapping text rects for axe");
});

test("Concept A hero subhead may use text-live on flat poster plate", () => {
  assert.match(SRC, /text-live[\s\S]*Job Packs from live employer career pages/);
});

test("jobs onboarding shell does not mount ambient grid under Concept A step 1", () => {
  const page = readFileSync("src/app/jobs/page.tsx", "utf8");
  const block = page.match(/showLandingOnboarding \? \([\s\S]*?\) : \(/m)?.[0] ?? "";
  assert.ok(block.length > 0, "showLandingOnboarding branch missing");
  assert.doesNotMatch(block, /LandingAnimatedBackground/, "ambient grid belongs on steps 2–3 only");
});

test("Landing onboarding steps 2–3 mount ambient grid behind the gate card", () => {
  const view = readFileSync("src/components/onboarding/LandingOnboardingView.tsx", "utf8");
  assert.match(view, /LandingAnimatedBackground/);
});

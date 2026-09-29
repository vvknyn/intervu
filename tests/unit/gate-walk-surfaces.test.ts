import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Cheap guard: permanent signed-in gate must cover all HARD contrast surfaces. */
test('gate-walk-signed-in.mjs covers privacy, landing, motion, and gate viewports', () => {
  const src = readFileSync('scripts/gate-walk-signed-in.mjs', 'utf8');
  assert.match(src, /runLandingSignedOut/, 'signed-out landing runner');
  assert.match(src, /runLandingAxeWithContrastFallback/, 'landing computed-AA fallback');
  // #652 (f6a8e9cc) made signed-out /jobs the board; the Concept A root is gone.
  assert.match(src, /data-testid="job-row"/, 'landing probes the signed-out board');
  assert.match(src, /\/privacy/, 'privacy route');
  assert.match(src, /1440,\s*height:\s*900/, 'desktop gate viewport');
  assert.match(src, /prefers-reduced-motion|reducedMotion/, 'reduced-motion emulation');
  assert.match(src, /color-contrast/, 'axe color-contrast rule');
  assert.match(src, /for-you-deck/, 'deck contrast scope');
  assert.match(src, /violationCount === 0/, 'axe violations are hard-fail');
});

test('gate landing contrast fallback module exports root probe and fallback runner', () => {
  const src = readFileSync('scripts/gate-landing-contrast-fallback.mjs', 'utf8');
  assert.match(src, /LANDING_ROOT_SEL/);
  assert.match(src, /contrastFallback/);
  assert.match(src, /contrastRatio/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Cheap guard: permanent signed-in gate must cover all HARD contrast surfaces. */
test('gate-walk-signed-in.mjs covers privacy, landing, motion, and gate viewports', () => {
  const src = readFileSync('scripts/gate-walk-signed-in.mjs', 'utf8');
  assert.match(src, /runLandingSignedOut/, 'signed-out landing runner');
  assert.match(src, /runAxeContrast\(page, 'document'\)/, 'landing scans full document (Concept A sits outside main)');
  assert.match(src, /\/privacy/, 'privacy route');
  assert.match(src, /1440,\s*height:\s*900/, 'desktop gate viewport');
  assert.match(src, /prefers-reduced-motion|reducedMotion/, 'reduced-motion emulation');
  assert.match(src, /color-contrast/, 'axe color-contrast rule');
  assert.match(src, /for-you-deck/, 'deck contrast scope');
  assert.match(src, /incompleteCount === 0/, 'incomplete results are hard-fail');
});

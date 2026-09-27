import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    extractPostcardCardFunction,
    extractPostcardStackBody,
    extractPostcardStackOpenTag,
} from "./concept-a-landing-stack-parse";

const SRC = readFileSync("src/components/onboarding/ConceptALanding.tsx", "utf8");
const GLOBALS = readFileSync("src/app/globals.css", "utf8");
const POSTCARD = extractPostcardCardFunction(SRC);

test("Concept A postcards render real titles, meta, and Live label", () => {
  assert.match(POSTCARD, /data-testid=\{`concept-a-postcard-\$\{index\}-title`\}/);
  assert.match(POSTCARD, /data-testid=\{`concept-a-postcard-\$\{index\}-meta`\}/);
  assert.match(POSTCARD, /data-testid=\{`concept-a-postcard-\$\{index\}-live`\}/);
  assert.match(POSTCARD, /\{title\}/);
  assert.match(POSTCARD, /\{meta\}/);
  assert.match(
    POSTCARD,
    /data-testid=\{`concept-a-postcard-\$\{index\}-live`\}[\s\S]*>\s*Live\s*</,
    "Live label text must follow indexed live test id (whitespace-tolerant JSX)",
  );
});

test("Concept A postcard copy renders inside decorative aria-hidden stack", () => {
  const stackOpen = extractPostcardStackOpenTag(SRC);
  assert.match(stackOpen, /\baria-hidden\b/, "stack opening tag must be aria-hidden");
  assert.match(stackOpen, /role="presentation"/, "stack opening tag must be presentational");

  assert.match(
    POSTCARD,
    /data-testid=\{`concept-a-postcard-\$\{index\}-title`\}/,
    "indexed title test id is defined on PostcardCard",
  );

  const stackBody = extractPostcardStackBody(SRC);
  assert.match(stackBody, /POSTCARDS\.map\(\(card, index\)/, "all postcards mount from stack map");
  assert.match(stackBody, /<PostcardCard/, "PostcardCard renders inside stack");
});

test("Concept A postcard Live uses postcard-safe tokens on cream", () => {
  assert.match(POSTCARD, /text-live-on-postcard/);
  assert.match(POSTCARD, /bg-live-on-postcard/);
  assert.doesNotMatch(POSTCARD, /\btext-live\b(?!-on-postcard)/);
});

test("Concept A postcard title typography stays unscaled on all breakpoints", () => {
  const titleLine =
    POSTCARD.match(
      /data-testid=\{`concept-a-postcard-\$\{index\}-title`\}[\s\S]*?className="([^"]+)"/,
    )?.[1] ?? "";
  assert.ok(titleLine.length > 0, "title className must be present");
  assert.doesNotMatch(titleLine, /\bscale-\[/, "postcard titles must not scale");
  assert.doesNotMatch(titleLine, /\btext-\[/, "postcard titles must not use arbitrary text size");
});

test("Concept A does not hide main or use design-lint file exemption", () => {
  assert.doesNotMatch(SRC, /design-lint-allow-file/);
  assert.doesNotMatch(SRC, /main\.style\.display/);
  assert.doesNotMatch(SRC, /display\s*=\s*["']none["']/);
});

test("Concept A keeps poster texture and real postcard stack", () => {
  assert.match(SRC, /poster-noise/);
  assert.match(SRC, /Remote AI Roles/);
  assert.match(SRC, /overflow-visible/);
});

test("Concept A hero copy column has no opaque poster plate", () => {
  const heroBlock = SRC.match(/Skip the job[\s\S]*?Start with your résumé/)?.[0] ?? "";
  assert.ok(heroBlock.length > 0, "hero copy block must exist");
  assert.doesNotMatch(heroBlock, /\bbg-surface-poster\b/, "hero column must not paint its own poster fill");
});

test("Concept A poster-noise keeps solid root fill and pseudo texture layer", () => {
  assert.match(GLOBALS, /\.poster-noise\s*\{[\s\S]*background-color:\s*rgb\(var\(--surface-poster\)\)/);
  assert.match(GLOBALS, /\.poster-noise::before\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(GLOBALS, /\.poster-noise::before[\s\S]*background-image:/);
  assert.doesNotMatch(
    GLOBALS,
    /\.poster-noise\s*\{[\s\S]*?background-image:/,
    "grain/vignette must not live on .poster-noise root",
  );
});

test("Concept A Step 1 toggles documented body class for scoped site chrome hide", () => {
  assert.match(SRC, /export const CONCEPT_A_LANDING_BODY_CLASS = "concept-a-landing-active"/);
  assert.match(SRC, /document\.body\.classList\.add\(CONCEPT_A_LANDING_BODY_CLASS\)/);
  assert.match(SRC, /document\.body\.classList\.remove\(CONCEPT_A_LANDING_BODY_CLASS\)/);
  const chromeHide = GLOBALS.match(
    /body\.concept-a-landing-active \[data-testid="topbar"\][\s\S]*?\{[\s\S]*?display:\s*none/,
  )?.[0];
  assert.ok(chromeHide, "globals must hide topbar while Step 1 body class is active");
  assert.match(chromeHide!, /\[data-testid="mobile-tabbar"\]/);
  assert.match(chromeHide!, /\[data-testid="site-footer"\]/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isLeanProductSurface,
  isQuietFooterPath,
  shouldHideSiteChrome,
} from "../../src/components/layout/should-hide-site-chrome";

const TOPBAR = path.join(__dirname, "../../src/components/layout/TopBar.tsx");

test("/oauth joins /login, /auth, /mock as a chrome-free surface", () => {
  // The consent screen (2026-08-27 polish) — same reasoning as /login: a
  // full-bleed card should not sit under the product TopBar/Footer/MobileTabBar.
  assert.equal(shouldHideSiteChrome("/oauth/authorize"), true);
  assert.equal(shouldHideSiteChrome("/oauth"), true);
});

test("existing chrome-free routes are unaffected by the /oauth addition", () => {
  assert.equal(shouldHideSiteChrome("/login"), true);
  assert.equal(shouldHideSiteChrome("/auth/callback"), true);
  assert.equal(shouldHideSiteChrome("/mock/completeness"), true);
});

test("an ordinary product route keeps its chrome — the probe can say no", () => {
  assert.equal(shouldHideSiteChrome("/jobs"), false);
  assert.equal(shouldHideSiteChrome("/co/acme--com"), false);
});

test("lean product loop includes jobs and résumé (signed-out header drops MCP link)", () => {
  assert.equal(isLeanProductSurface("/jobs"), true);
  assert.equal(isLeanProductSurface("/jobs/company/acme"), true);
  assert.equal(isLeanProductSurface("/resume"), true);
  assert.equal(isLeanProductSurface("/resume/edit"), true);
  assert.equal(isLeanProductSurface("/yours"), false);
  assert.equal(isLeanProductSurface("/connect"), false);
});

test("remote-jobs hub quiets the SEO footer; other hubs and product routes do not", () => {
  assert.equal(isQuietFooterPath("/careers/remote-jobs"), true);
  assert.equal(isQuietFooterPath("/careers/tech-jobs"), false);
  assert.equal(isQuietFooterPath("/jobs"), false);
  assert.equal(isQuietFooterPath("/about"), false);
  const footer = readFileSync(
    path.join(__dirname, "../../src/components/layout/Footer.tsx"),
    "utf8",
  );
  assert.match(footer, /isQuietFooterPath\(pathname\)/);
  assert.match(footer, /LeanFooterContent/);
});

test("TopBar filters desktop /connect on lean surfaces and when signed out", () => {
  const src = readFileSync(TOPBAR, "utf8");
  assert.match(src, /isLeanProductSurface\(pathname\)/);
  assert.match(src, /leanSurface/);
  // e8aa53a1 turned the /connect filter into an allow predicate (same rule, positive form).
  assert.match(src, /return !leanSurface && authChrome === "authenticated";/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * posthog-js (~240 KB of JS) loads only with PostHogProvider, after the page
 * (DeferredPostHogProvider). One value import anywhere else puts the whole
 * library back into every page's first-load bundle: events.ts did exactly
 * that, and on a throttled phone it was parsed ahead of hydration on every
 * /jobs load. Everything else reaches PostHog through posthog-client.ts.
 */
const ROOT = join(__dirname, "../..");
const ALLOWED = new Set(["src/components/providers/PostHogProvider.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("only PostHogProvider imports posthog-js values", () => {
  const offenders = sourceFiles(join(ROOT, "src"))
    .map((path) => relative(ROOT, path))
    .filter((file) => !ALLOWED.has(file))
    .filter((file) =>
      /^\s*import\s+(?!type\b)[^;]*from\s+["']posthog-js(\/[^"']*)?["']/m.test(readFileSync(join(ROOT, file), "utf8")),
    );
  assert.deepEqual(offenders, [], "import PostHog through src/lib/analytics/posthog-client.ts instead");
});

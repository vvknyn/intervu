/**
 * Release 75's live check read "Remove Near Canada · Remote (detected) 1 roles" on a broaden chip. Class: a count
 * written beside a fixed "roles", which reads "1 roles" when the count is one. `rolesLabel` (lib/format.ts) writes the
 * count with its noun; the scan pins that no count beside a bare "roles" is left in the app's source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { rolesLabel } from "../../src/lib/format";

test("a count of roles is singular for exactly one, plural otherwise, and keeps the page's own way of writing it", () => {
  assert.equal(rolesLabel(1), "1 role");
  assert.equal(rolesLabel(0), "0 roles");
  assert.equal(rolesLabel(2), "2 roles");
  assert.equal(rolesLabel(12345), "12,345 roles");
  assert.equal(
    rolesLabel(1, "1+"),
    "1+ roles",
    "a lower bound is more than one",
  );
  assert.equal(rolesLabel(1000, "1,000+"), "1,000+ roles");
});

const ROOT = join(__dirname, "../../src");
/** An interpolated count (`{n} roles`, `${n} roles`): an expression that reads as a number of roles. */
const COUNT_BESIDE_ROLES = /\{([^{}]+)\}\s+roles\b/g;
const LOOKS_LIKE_A_COUNT =
  /count|Count|total|Total|toLocaleString|formatCount|formatCorpusCount|openCountLabel|openCountText|hidden|considered|\bread\b|Size\b|\bn\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "mock" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no count in the app is written beside a bare "roles"', () => {
  const found: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // A comment, or a count whose noun is already picked by it ("=== 1 ? ..." on the line or just above), is not the class.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      if (
        lines
          .slice(Math.max(0, i - 2), i + 1)
          .some((l) =>
            /[=!]==? ?["']?1["']?\s*$|[=!]==? ?["']?1["']?\s*\?/.test(l),
          )
      )
        return;
      for (const m of line.matchAll(COUNT_BESIDE_ROLES)) {
        if (LOOKS_LIKE_A_COUNT.test(m[1]))
          found.push(`${relative(ROOT, file)}:${i + 1} ${m[0]}`);
      }
    });
  }
  assert.deepEqual(
    found,
    [],
    `write these with rolesLabel:\n${found.join("\n")}`,
  );
});

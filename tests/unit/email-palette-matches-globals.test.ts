import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  EMAIL_COLORS,
  EMAIL_COLOR_TOKENS,
  EMAIL_TOKEN_SOURCE,
  paperLineHex,
} from "@/lib/email/templates/palette";

/**
 * Email cannot use CSS variables, so `palette.ts` keeps a hard-coded copy of
 * the product's design tokens. These tests pin each literal to the token it
 * claims to copy; the second stops a literal being written anywhere else.
 */

const REPO_ROOT = join(__dirname, "..", "..");

function lightThemeBlock(css: string): string {
  const open = css.indexOf("{", css.indexOf(":root"));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces in :root");
}

function tokenHex(block: string, token: string): string {
  const match = block.match(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`));
  assert.ok(match, `${token} is not declared as an RGB triple in ${EMAIL_TOKEN_SOURCE}`);
  return `#${match.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

describe("email palette tracks globals.css", () => {
  const block = lightThemeBlock(readFileSync(join(REPO_ROOT, EMAIL_TOKEN_SOURCE), "utf8"));

  for (const [role, token] of Object.entries(EMAIL_COLOR_TOKENS)) {
    it(`${role} still equals ${token}`, () => {
      assert.equal(
        EMAIL_COLORS[role as keyof typeof EMAIL_COLORS],
        tokenHex(block, token),
        `email colour "${role}" has drifted from ${token}. Update EMAIL_COLORS in ` +
          `src/lib/email/templates/palette.ts — do NOT relax this test.`,
      );
    });
  }

  it("line still equals 12% postcard foreground over postcard fill", () => {
    const fg = tokenHex(block, "--surface-postcard-foreground");
    const bg = tokenHex(block, "--surface-postcard");
    assert.equal(
      EMAIL_COLORS.line,
      paperLineHex(fg, bg),
      "paper rule line must track the postcard ink/fill pair in globals.css",
    );
  });
});

function scannableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/&#\d+;?/g, "");
}

function emailSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return emailSourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && entry.name !== "palette.ts" ? [path] : [];
  });
}

describe("no email file hard-codes a colour outside the palette", () => {
  const emailDir = join(REPO_ROOT, "src", "lib", "email");

  for (const file of emailSourceFiles(emailDir)) {
    it(`${file.slice(REPO_ROOT.length + 1)} uses EMAIL_COLORS`, () => {
      const colours = scannableSource(readFileSync(file, "utf8")).match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
      assert.deepEqual(
        colours,
        [],
        `hard-coded colour(s) ${colours.join(", ")} — import EMAIL_COLORS from templates/palette instead, ` +
          `so the drift test above can see them.`,
      );
    });
  }
});

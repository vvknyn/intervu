import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { EMAIL_COLORS, EMAIL_COLOR_TOKENS, EMAIL_TOKEN_SOURCE } from "@/lib/email/templates/palette";

/**
 * Email cannot use CSS variables, so `palette.ts` keeps a hard-coded copy of
 * the product's design tokens. A copy with nothing checking it is a copy that
 * goes stale, and this one did: the Swiss Tinted Glass redesign (#217, merged
 * 2026-08-17) moved `--brand` from emerald `16 149 106` to International
 * Klein Blue `0 47 167` and shifted the neutrals off the slate ramp. Every
 * email kept rendering and every test kept passing while the brand colour was
 * simply wrong — the failure had no symptom anyone could trip over.
 *
 * These two tests give it one. The first pins each literal to the token it
 * claims to copy; the second stops a literal being written anywhere else,
 * because a value that isn't in `palette.ts` is a value the first test
 * cannot see.
 */

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The first `:root` block only. `globals.css` has a second one inside a media
 * query and a `.dark` block right after, both of which redeclare the same
 * names — matching a token anywhere in the file would pick up whichever came
 * last. Brace counting rather than "read until `.dark`" so this keeps working
 * when a block is added between them.
 */
function lightThemeBlock(css: string): string {
  const open = css.indexOf("{", css.indexOf(":root"));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces in :root");
}

/** Tokens are stored as space-separated RGB channels for Tailwind's
 *  `rgb(var(--x) / <alpha>)` form, so they need converting to compare. */
function tokenHex(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}\\s*:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`));
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
});

/**
 * Block comments and whole-line `//` comments only. Stripping `//` wherever
 * it appears would eat the one in `https://` and take the rest of that line's
 * markup with it. Comments have to go because the templates legitimately
 * DISCUSS colours they must not use — the note in `base.ts` about the brand
 * mark's three conflicting dot values is the reason this guard would
 * otherwise fail on a correct file.
 */
function scannableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    // HTML numeric entities (`&#8203;`, `&#39;`) look exactly like short hex
    // colours. Dropping them by shape instead — "all digits" — would also
    // drop #002FA7's all-digit cousins, so drop them by syntax.
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

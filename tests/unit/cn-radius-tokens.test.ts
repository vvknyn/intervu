import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cn, RADIUS_TOKENS } from "../../src/lib/utils";

/* ------------------------------ cn() override direction ------------------------------ */

test("cn: a semantic radius token other than ctl overrides rounded-none (ctl is the one that surfaced the original bug — this proves the fix is class-wide, not ctl-specific)", () => {
    assert.equal(cn("rounded-none", "rounded-panel"), "rounded-panel");
});

test("cn: token vs token — the later semantic radius class wins", () => {
    assert.equal(cn("rounded-pill", "rounded-ctl"), "rounded-ctl");
});

test("cn: the override direction also works — rounded-none coming after a semantic token wins, unrelated utilities untouched", () => {
    assert.equal(cn("rounded-ctl", "p-2", "rounded-none"), "p-2 rounded-none");
});

/* ------------------------------ globals.css <-> RADIUS_TOKENS pairing ------------------------------ */

// Two sources of truth for the same set of names (globals.css declares the
// tokens, utils.ts registers them with tailwind-merge) will drift the
// moment someone adds one and forgets the other — this test is the guard:
// it fails the instant those two lists disagree, in either direction.
//
// Discriminator: every --radius-<name> in globals.css is either (a) part
// of Tailwind's own default scale (2xs/xs/sm/md/lg/xl/2xl/3xl/4xl — kept
// at their pre-soft-surfaces values, several already non-zero) or (b) one
// of this PR's semantic role tokens. "value is 0px" does NOT separate
// these groups (sm/md/lg/xl/2xl/3xl/4xl are already non-zero pre-existing
// tokens), so this matches Tailwind's T-shirt-size naming SHAPE instead —
// the same kind of shape rule scripts/design/banned-classes.cjs's SIZE
// enum encodes, applied here to CSS custom-property names rather than
// class suffixes. Anything that doesn't fit that shape (ctl, panel, pill,
// or a future semantic token) must be in RADIUS_TOKENS.
const TSHIRT_SIZE_SHAPE = /^(\d*x[sl]|sm|md|lg)$/;

test("RADIUS_TOKENS in utils.ts matches every non-T-shirt-size --radius-<name> declared in globals.css's @theme block(s)", () => {
    const cssPath = path.join(__dirname, "../../src/app/globals.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // globals.css declares more than one `@theme { ... }` / `@theme inline { ... }`
    // block (color tokens in one, the font/shadow/radius scale in another) —
    // collect every block's body instead of assuming the first "@theme" hit
    // in the file is the one that contains the radius scale.
    const themeBlocks: string[] = [];
    const themeOpenRe = /@theme[^{]*\{/g;
    let openMatch: RegExpExecArray | null;
    while ((openMatch = themeOpenRe.exec(css))) {
        const bodyStart = openMatch.index + openMatch[0].length;
        const bodyEnd = css.indexOf("\n}", bodyStart);
        themeBlocks.push(css.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd));
    }
    assert.ok(themeBlocks.length > 0, "expected at least one @theme block in globals.css");

    const declared = new Set<string>();
    for (const block of themeBlocks) {
        for (const m of block.matchAll(/--radius-([a-z0-9]+)\s*:\s*([^;]+);/g)) {
            const name = m[1];
            if (TSHIRT_SIZE_SHAPE.test(name)) continue;
            declared.add(name);
        }
    }

    assert.deepEqual(declared, new Set(RADIUS_TOKENS));
});

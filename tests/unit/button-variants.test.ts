import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards docs/design/rulebook-2026-09/RULEBOOK.md line 15's button ladder:
 * "primary = filled #002FA7 ... one per region; tertiary = 1px #002FA7
 * outline, blue text; ghost = blue text only. NO uppercase, NO
 * letter-spacing, NO gray-filled secondary."
 *
 * Deliberately does NOT import button.tsx (it pulls React/radix into a
 * node:test run) — it reads the file as text and parses the `variant: {
 * ... }` block out of it, so the properties below are checked against
 * whatever variant table actually ships, not a hand-copied expectation of it.
 * Matching is on class SHAPE (a `bg-*`/`border` token), never an enumerated
 * variant-name list, so a variant added after this change is covered by
 * construction.
 */

const ROOT = path.resolve(__dirname, "../..");
const BUTTON_SOURCE = readFileSync(path.join(ROOT, "src/components/ui/button.tsx"), "utf8");

/**
 * Finds the `variant: { ... }` object literal inside a cva() call and
 * returns its raw contents (excluding the outer braces). Located by the
 * first bare `variant:` key (not `variants:`, which always precedes it) and
 * closed by counting braces, so it stops before the sibling `size: { ... }`
 * block without needing to know that block's name.
 */
function extractVariantBlock(source: string): string {
    const idx = source.indexOf("variant:");
    assert.ok(idx >= 0, "no `variant:` key found in source");
    const braceStart = source.indexOf("{", idx);
    assert.ok(braceStart >= 0, "no `{` following `variant:`");

    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    assert.ok(end >= 0, "unbalanced braces while scanning the `variant:` block");
    return source.slice(braceStart + 1, end);
}

/** Every top-level `const NAME = "..."` in the file, name -> string value. */
function extractStringConsts(source: string): Map<string, string> {
    const consts = new Map<string, string>();
    for (const m of source.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
        consts.set(m[1], m[2]);
    }
    return consts;
}

/**
 * Parses `name: "classes",` pairs out of a variant block — handling both a
 * same-line string and the `name:\n  "classes",` multi-line form — and, for
 * a variant pointing at a shared constant instead of an inline literal
 * (`name: SOME_CONST,`), resolves it against `consts`. This is what lets a
 * single shared tertiary-shape constant, referenced by three variant keys,
 * still get judged as three separate class strings.
 */
function parseVariantPairs(block: string, consts: Map<string, string>): Map<string, string> {
    const withoutLineComments = block.replace(/^\s*\/\/.*$/gm, "");
    const pairRe =
        /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_][A-Za-z0-9_]*))\s*,/g;
    const pairs = new Map<string, string>();
    for (const m of withoutLineComments.matchAll(pairRe)) {
        const name = m[1];
        const literal = m[2] ?? m[3];
        if (literal !== undefined) {
            pairs.set(name, literal);
            continue;
        }
        const ident = m[4];
        assert.ok(consts.has(ident), `variant "${name}" references undefined const "${ident}"`);
        pairs.set(name, consts.get(ident)!);
    }
    return pairs;
}

function extractVariantMap(source: string): Map<string, string> {
    return parseVariantPairs(extractVariantBlock(source), extractStringConsts(source));
}

/** Whitespace-split classes, dropping any modifier-prefixed one (hover:, focus-visible:, ...). */
function restingTokens(classes: string): string[] {
    return classes.split(/\s+/).filter(Boolean).filter((cls) => !cls.includes(":"));
}

const ALLOWED_RESTING_BG = new Set(["bg-brand", "bg-danger-text", "bg-transparent"]);
/** A brand tint (`bg-brand-wash`) is still Klein: a faint wash of the brand, not a grey. */
const BRAND_TINT_BG = /^bg-brand-wash$/;

/** Rule (a): every resting bg-* token is Klein, red, or no fill at all. */
function isFilledKleinOrRedOrTransparent(classes: string): boolean {
    return restingTokens(classes)
        .filter((cls) => cls.startsWith("bg-"))
        .every((cls) => ALLOWED_RESTING_BG.has(cls) || BRAND_TINT_BG.test(cls));
}

/** Rule (b): a variant using the bare `border` utility is the Klein tertiary. */
function isKleinTertiaryIfOutlined(classes: string): boolean {
    const tokens = restingTokens(classes);
    if (!tokens.includes("border")) return true;
    return tokens.includes("border-brand") && tokens.includes("text-brand");
}

test("buttons are filled Klein or red, never a surface tint", () => {
    const offenders = [...extractVariantMap(BUTTON_SOURCE).entries()]
        .filter(([, classes]) => !isFilledKleinOrRedOrTransparent(classes))
        .map(([name]) => name);
    assert.deepEqual(
        offenders,
        [],
        `variant(s) with a non-brand/danger/transparent resting fill: ${offenders.join(", ")}. ` +
            `RULEBOOK.md: "NO gray-filled secondary."`,
    );
});

test("outlined buttons are the Klein tertiary", () => {
    const offenders = [...extractVariantMap(BUTTON_SOURCE).entries()]
        .filter(([, classes]) => !isKleinTertiaryIfOutlined(classes))
        .map(([name]) => name);
    assert.deepEqual(
        offenders,
        [],
        `bordered variant(s) not on the Klein tertiary (border-brand + text-brand): ${offenders.join(", ")}. ` +
            `RULEBOOK.md: "tertiary = 1px #002FA7 outline, blue text."`,
    );
});

test("variant-ladder classifiers: shape-based, proven on fixtures other than button.tsx's own variants", () => {
    // The presence sibling for both absence assertions above: a small,
    // hand-built variant block — not the real file — with one grey-filled
    // variant, one hairline-outlined variant, and one already-compliant
    // variant, proving the parser and both rules actually flag the broken
    // shapes and leave the compliant one alone.
    const fixture = `
const buttonVariants = cva("", {
  variants: {
    variant: {
      ok: "bg-brand text-brand-foreground hover:bg-brand-hover",
      grayFilled: "bg-muted text-foreground hover:bg-border",
      hairlineOutline: "border border-border bg-transparent text-foreground hover:bg-muted",
    },
  },
});
`;
    const variants = extractVariantMap(fixture);
    assert.deepEqual([...variants.keys()], ["ok", "grayFilled", "hairlineOutline"], "parser must find all three fixture variants");

    const fillOffenders = [...variants.entries()]
        .filter(([, classes]) => !isFilledKleinOrRedOrTransparent(classes))
        .map(([name]) => name);
    assert.deepEqual(fillOffenders, ["grayFilled"], "the grey-filled fixture variant must be flagged, and only it");

    const outlineOffenders = [...variants.entries()]
        .filter(([, classes]) => !isKleinTertiaryIfOutlined(classes))
        .map(([name]) => name);
    assert.deepEqual(outlineOffenders, ["hairlineOutline"], "the hairline-outlined fixture variant must be flagged, and only it");
});

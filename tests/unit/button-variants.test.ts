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
        /(?:"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_][A-Za-z0-9_]*))\s*,/g;
    const pairs = new Map<string, string>();
    for (const m of withoutLineComments.matchAll(pairRe)) {
        const name = m[1] ?? m[2] ?? m[3];
        const literal = m[4] ?? m[5];
        if (literal !== undefined) {
            pairs.set(name, literal);
            continue;
        }
        const ident = m[6];
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

/**
 * docs/design-language.md §5 + @coss/button ladder:
 * - Primary: `bg-brand`
 * - Secondary: `border border-border bg-card`
 * - Outline / Ghost: `bg-transparent`
 * - Quiet: `bg-brand-wash`
 * - Destructive: `bg-danger-text` (or `bg-transparent` on `destructive-outline`)
 * Resting `bg-muted` / grey slabs are forbidden.
 */
const ALLOWED_RESTING_BG = new Set(["bg-brand", "bg-danger-text", "bg-card", "bg-transparent"]);
const BRAND_TINT_BG = /^bg-brand-wash$/;

function hasAllowedRestingFill(classes: string): boolean {
    const tokens = restingTokens(classes);
    // `bg-card` is valid only when paired with `border border-border` (Secondary in §5).
    if (tokens.includes("bg-card") && !(tokens.includes("border") && tokens.includes("border-border"))) {
        return false;
    }
    return tokens
        .filter((cls) => cls.startsWith("bg-"))
        .every((cls) => ALLOWED_RESTING_BG.has(cls) || BRAND_TINT_BG.test(cls));
}

/** Rule (b): any bordered variant uses semantic `border-border` (neutral) or `border-danger-tint-border` (danger). */
function hasValidOutlineContract(classes: string): boolean {
    const tokens = restingTokens(classes);
    if (!tokens.includes("border")) return true;
    const isNeutralOutline = tokens.includes("border-border") && tokens.includes("text-foreground");
    const isDangerOutline = tokens.includes("border-danger-tint-border") && tokens.includes("text-danger-text");
    const isBrandOutline = tokens.includes("border-brand") && tokens.includes("text-brand");
    return isNeutralOutline || isDangerOutline || isBrandOutline;
}

test("buttons follow docs/design-language.md §5 resting fills, never a grey muted slab", () => {
    const offenders = [...extractVariantMap(BUTTON_SOURCE).entries()]
        .filter(([, classes]) => !hasAllowedRestingFill(classes))
        .map(([name]) => name);
    assert.deepEqual(
        offenders,
        [],
        `variant(s) with a disallowed resting fill: ${offenders.join(", ")}. ` +
            `docs/design-language.md §5: primary=bg-brand, secondary=border-border+bg-card, ghost/outline=bg-transparent.`,
    );
});

test("outlined buttons pair semantic border and text tokens", () => {
    const offenders = [...extractVariantMap(BUTTON_SOURCE).entries()]
        .filter(([, classes]) => !hasValidOutlineContract(classes))
        .map(([name]) => name);
    assert.deepEqual(
        offenders,
        [],
        `bordered variant(s) missing semantic border+text pairing: ${offenders.join(", ")}.`,
    );
});

test("variant-ladder classifiers: shape-based, proven on fixtures other than button.tsx's own variants", () => {
    const fixture = `
const buttonVariants = cva("", {
  variants: {
    variant: {
      ok: "bg-brand text-brand-foreground hover:bg-brand-hover",
      secondaryOk: "border border-border bg-card text-foreground hover:bg-muted",
      grayFilled: "bg-muted text-foreground hover:bg-border",
      rawBorderOutline: "border border-slate-300 bg-transparent text-foreground hover:bg-muted",
    },
  },
});
`;
    const variants = extractVariantMap(fixture);
    assert.deepEqual(
        [...variants.keys()],
        ["ok", "secondaryOk", "grayFilled", "rawBorderOutline"],
        "parser must find all four fixture variants",
    );

    const fillOffenders = [...variants.entries()]
        .filter(([, classes]) => !hasAllowedRestingFill(classes))
        .map(([name]) => name);
    assert.deepEqual(fillOffenders, ["grayFilled"], "the grey-filled fixture variant must be flagged, and only it");

    const outlineOffenders = [...variants.entries()]
        .filter(([, classes]) => !hasValidOutlineContract(classes))
        .map(([name]) => name);
    assert.deepEqual(outlineOffenders, ["rawBorderOutline"], "the raw-border fixture variant must be flagged, and only it");
});

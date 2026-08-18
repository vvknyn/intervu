import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Guards the three rules in docs/design/DESIGN-LANGUAGE.md that this repo had
 * silently stopped obeying. Each assertion is written against the RULE, not
 * against the specific tokens that were found broken — a newly added shadow
 * key, a newly hue-named token or a seventh copy of the brand mark fails here
 * without anyone remembering to extend a list.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/** Declarations only — never comment prose, which legitimately names colours. */
function declarations(css: string): Array<{ name: string; value: string }> {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    return [...withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => ({
        name: m[1],
        value: m[2].trim(),
    }));
}

function tokenTriplet(css: string, name: string, scope: "root" | "dark"): string {
    // Both scopes declare the same names, so the block has to be sliced before
    // matching. Anchor on the selector at the start of a line — `.dark` also
    // occurs inside `@custom-variant dark (&:is(.dark *))` near the top of the
    // file, and slicing from there reads the @theme block instead.
    const selector = new RegExp(`^${scope === "root" ? ":root" : "\\.dark"}\\s*\\{`, "m");
    const start = css.search(selector);
    assert.ok(start >= 0, `no ${scope} block in globals.css`);
    const block = css.slice(start, css.indexOf("\n}", start));
    const hit = block.match(new RegExp(`${name}\\s*:\\s*([0-9]+ [0-9]+ [0-9]+)\\s*;`));
    assert.ok(hit, `${name} not found as an RGB triplet in ${scope}`);
    return hit[1];
}

function tripletToHex(triplet: string): string {
    return (
        "#" +
        triplet
            .split(/\s+/)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()
    );
}

test("elevation is none: every --shadow-* key resolves to none", () => {
    const shadows = declarations(GLOBALS).filter((d) => d.name.startsWith("--shadow-"));

    assert.ok(shadows.length > 0, "no --shadow-* tokens found — did the scale move?");
    for (const { name, value } of shadows) {
        assert.equal(
            value,
            "none",
            `${name} is "${value}". DESIGN-LANGUAGE.md: "Elevation: none. Separation comes ` +
                `from a 1px --border and whitespace." Zero it rather than re-tinting it.`,
        );
    }

    // The bug this replaces was a token declared twice with different values in
    // one file, where the winner depended on Tailwind hoisting @theme above
    // :root. One declaration per key removes the question entirely.
    const names = shadows.map((s) => s.name);
    assert.deepEqual(
        names,
        [...new Set(names)],
        `a --shadow-* key is declared more than once: ${names.join(", ")}`,
    );
});

test("no token is named for a hue — names describe the role", () => {
    // `--green-tint-bg` held blue-50 for as long as the accent had been Klein
    // blue. A name that contradicts its value is how a retired colour gets
    // reintroduced by someone trusting the name.
    const hue = /(green|red|blue|orange|purple|teal|amber|emerald|violet|pink|yellow)/;
    const offenders = declarations(GLOBALS)
        .map((d) => d.name)
        .filter((n) => hue.test(n));

    assert.deepEqual(
        offenders,
        [],
        `token(s) named for a hue: ${offenders.join(", ")}. Name them for what they mean.`,
    );
});

test("elevation is achromatic — a shadow never carries a hue", () => {
    // The glass panels cast rgba(15,23,42) slate shadows while the ramp beneath
    // them is purely neutral (--foreground 10 10 10), so every lifted edge had
    // a faint blue cast belonging to no token. Scoped to box-shadow on purpose:
    // DESIGN-LANGUAGE.md governs elevation as a structural device — separation
    // by border and whitespace — so a shadow is a shade of grey by definition.
    // Content colour (the .glass-tint-* chips) is a separate, open question and
    // is deliberately not judged here.
    const withoutComments = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];

    for (const decl of withoutComments.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
        // Split on commas outside parens: one declaration is a list of layers,
        // and only the lifting ones are elevation. An `inset` layer is a sheen
        // painted on the surface itself (the .glass-tint-* chips use hued ones
        // deliberately), and a var() layer is already theme-owned.
        for (const layer of decl[1].split(/,(?![^(]*\))/)) {
            if (layer.includes("inset") || layer.includes("var(")) continue;
            for (const c of layer.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)/g)) {
                const [r, g, b] = [+c[1], +c[2], +c[3]];
                if (!(r === g && g === b)) offenders.push(c[0]);
            }
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `hued shadow colour(s): ${offenders.join(", ")}. Elevation is a shade of grey; ` +
            `a tint here means the shadow belongs to a palette the ramp no longer uses.`,
    );
});

test("the brand mark has exactly one dot colour, and it is the --live token", () => {
    const markSource = readFileSync(
        path.join(ROOT, "src/components/brand/BrandMark.tsx"),
        "utf8",
    );
    const declared = markSource.match(/BRAND_MARK_DOT_FILL\s*=\s*"(#[0-9A-Fa-f]{6})"/);
    assert.ok(declared, "BRAND_MARK_DOT_FILL is no longer exported from BrandMark.tsx");

    assert.equal(
        declared[1].toUpperCase(),
        tripletToHex(tokenTriplet(GLOBALS, "--live", "root")),
        "BRAND_MARK_DOT_FILL has drifted from the light --live token",
    );

    // The favicon is a dark-ground artifact with no cascade, so it takes .dark.
    const icon = readFileSync(path.join(ROOT, "src/app/icon.svg"), "utf8");
    const iconDot = icon.match(/<circle[^>]*fill="(#[0-9A-Fa-f]{6})"/);
    assert.ok(iconDot, "icon.svg has no dot circle");
    assert.equal(
        iconDot[1].toUpperCase(),
        tripletToHex(tokenTriplet(GLOBALS, "--live", "dark")),
        "icon.svg's dot has drifted from the dark --live token",
    );

    const markSvg = readFileSync(path.join(ROOT, "public/mark.svg"), "utf8");
    const markDot = markSvg.match(/<circle[^>]*fill="(#[0-9A-Fa-f]{6})"/);
    assert.ok(markDot, "public/mark.svg has no dot circle");
    assert.equal(
        markDot[1].toUpperCase(),
        declared[1].toUpperCase(),
        "public/mark.svg's dot has drifted from BRAND_MARK_DOT_FILL",
    );
});

test("nothing outside globals.css assigns a core design token at runtime", () => {
    // ThemeProvider wrote --brand/--brand-foreground/--brand-muted as inline
    // styles on documentElement, which outrank every stylesheet rule — so
    // globals.css did not actually own the brand colour, and PR #217's move to
    // International Klein Blue was inert on every page load. DESIGN-LANGUAGE.md:
    // "globals.css — the only place values live", "Scoped remaps of core token
    // names are forbidden." A component may READ a token; assigning one moves
    // the source of truth somewhere the design system cannot see.
    const offenders: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.tsx?$/.test(entry)) {
                const src = readFileSync(full, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                if (/setProperty\(\s*["'`]--/.test(src)) offenders.push(path.relative(ROOT, full));
            }
        }
    };
    walk(path.join(ROOT, "src"));

    assert.deepEqual(
        offenders,
        [],
        `runtime token assignment in: ${offenders.join(", ")} — change the value in globals.css.`,
    );
});

test("no renderer hardcodes the mark's dot fill instead of importing it", () => {
    // The drift happened because BrandMark centralised GEOMETRY only, so five
    // other renderers hand-copied the colour. This catches a sixth.
    const offenders: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.tsx?$/.test(entry)) {
                const src = readFileSync(full, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                if (/BRAND_MARK_DOT\.r\}\s*fill="#/.test(src)) {
                    offenders.push(path.relative(ROOT, full));
                }
            }
        }
    };
    walk(path.join(ROOT, "src"));

    assert.deepEqual(
        offenders,
        [],
        `hardcoded dot fill in: ${offenders.join(", ")} — import BRAND_MARK_DOT_FILL instead.`,
    );
});

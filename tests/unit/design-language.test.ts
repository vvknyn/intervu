import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Guards the three rules in docs/design/DESIGN-LANGUAGE.md that this repo had
 * silently stopped obeying. Each assertion is written against the RULE, not
 * against the specific tokens that were found broken — a newly added shadow
 * key, a newly hue-named token or a seventh copy of the brand mark fails here
 * without anyone remembering to extend a list.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const LAYOUT = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

/** Canonical body sans prefix — must match @theme `--font-sans` in globals.css exactly. */
const SOURCE_SANS_SANS_PREFIX = 'var(--font-sans-face), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Declarations only — never comment prose, which legitimately names colours. */
function declarations(css: string): Array<{ name: string; value: string }> {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    return [...withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => ({
        name: m[1],
        value: m[2].trim(),
    }));
}

/**
 * The Tailwind-generated shadow SCALE (--shadow-2xs..2xl, --shadow-inner) —
 * the keys that back a `shadow-{size}` utility, mapped to their FRAMEWORK
 * STOCK value (e.g. `--shadow-2xl` -> `0 25px 50px -12px rgb(0 0 0 / 0.25)`).
 * Read from the framework rather than hardcoded so a future Tailwind release
 * that adds a step is covered by construction, both for DESIGN-LANGUAGE.md's
 * "Elevation: none" rule (which zeros every key in globals.css) and for the
 * named-preset shadow-utility guard below (which classifies a bare
 * `shadow-{size}` by the shadow it would cast if this repo didn't zero it —
 * the shape the "never a raw named-scale shadow-* class" rule actually bans).
 * Deliberately excludes `--shadow-overlay`: that token is not part of
 * Tailwind's generated scale (no `shadow-overlay` utility exists), so a
 * plain --shadow- prefix match would wrongly fold the one sanctioned
 * non-zero shadow into either check.
 */
function tailwindShadowScaleDefaults(): Map<string, string> {
    const themeCss = readFileSync(path.join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");
    const defaults = new Map(
        [...themeCss.matchAll(/^\s*(--shadow-[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
    );
    assert.ok(defaults.size > 0, "could not read Tailwind's default shadow scale");
    return defaults;
}

function tailwindShadowScaleKeys(): Set<string> {
    return new Set(tailwindShadowScaleDefaults().keys());
}

test("type scale: body default and theme tokens wired at the chokepoint", () => {
    assert.match(GLOBALS, /body\s*\{[\s\S]*?font-size:\s*16px;/, "body font-size must be 16px (text-body role)");
    const themeBlock = GLOBALS.slice(GLOBALS.indexOf("@theme {"), GLOBALS.indexOf("\n}", GLOBALS.indexOf("@theme {")) + 2);
    assert.match(themeBlock, /--text-body:\s*1rem;/, "@theme must register --text-body");
    assert.match(themeBlock, /--text-meta:\s*0\.875rem;/, "@theme must register --text-meta");
    assert.match(themeBlock, /--text-xs:\s*0\.75rem;/, "@theme must override --text-xs to 0.75rem (12px)");
    assert.match(themeBlock, /--text-sm:\s*0\.875rem;/, "@theme must override --text-sm to 0.875rem (14px)");
});

test("body sans token: Source Sans 3 via next/font static cuts", () => {
    const themeStart = GLOBALS.indexOf("@theme {");
    assert.ok(themeStart >= 0, "@theme block missing from globals.css");
    const themeEnd = GLOBALS.indexOf("\n}", themeStart);
    const themeBlock = GLOBALS.slice(themeStart, themeEnd + 2);
    const sans = declarations(themeBlock).find((d) => d.name === "--font-sans");
    assert.ok(sans, "--font-sans must be declared in @theme");
    assert.equal(
        sans.value,
        SOURCE_SANS_SANS_PREFIX,
        "--font-sans must prefix with --font-sans-face (Source Sans 3) before system fallbacks",
    );
    assert.match(LAYOUT, /Source_Sans_3/, "layout.tsx must load Source Sans 3 via next/font");
    assert.match(LAYOUT, /variable:\s*"--font-sans-face"/, "Source Sans 3 must wire --font-sans-face");
    // 500 is the button face (globals.css `--control-weight`, control-type.test.ts): loaded as its own static cut so it renders at 500, not the 400 fallback.
    assert.match(LAYOUT, /weight:\s*\[\s*"400"\s*,\s*"500"\s*,\s*"600"\s*\]/, "Source Sans 3 must use static 400/500/600 cuts, not default variable axis");
});

test("body typography: no global OpenType cv/ss feature overrides", () => {
    const bodyBlock = GLOBALS.match(/body\s*\{[\s\S]*?\}/)?.[0] ?? "";
    assert.ok(bodyBlock.length > 0, "body { … } block missing from globals.css");
    assert.match(
        bodyBlock,
        /font-feature-settings:\s*normal\s*;/,
        "body must use font-feature-settings: normal — body-wide cv/ss overrides mis-space small labels",
    );
    assert.match(
        bodyBlock,
        /font-variant-ligatures:\s*no-contextual\s*;/,
        "body must disable contextual alternates (calt) without cv/ss feature overrides",
    );
    assert.doesNotMatch(
        bodyBlock,
        /font-feature-settings:[^;]*\bcv\d+/,
        "body must not enable custom character variants globally",
    );
    assert.doesNotMatch(bodyBlock, /font-feature-settings:[^;]*\bss\d+/, "body must not enable stylistic sets globally");
});

test("wordmark lockup: warm white text token, never brand green on Velai", () => {
    const brandMark = readFileSync(path.join(ROOT, "src/components/brand/BrandMark.tsx"), "utf8");
    assert.match(brandMark, /BRAND_LOCKUP_WORDMARK_CLASS\s*=\s*"text-wordmark"/, "BrandLockup must use text-wordmark");
    assert.doesNotMatch(
        brandMark,
        /BrandLockup[\s\S]*text-brand/,
        "BrandLockup must not paint the wordmark with text-brand",
    );
    assert.match(brandMark, />\s*Velai\s*</, "wordmark copy must stay title-case Velai");
    const wordmarkToken = declarations(GLOBALS).find((d) => d.name === "--wordmark-foreground");
    assert.ok(wordmarkToken, "--wordmark-foreground must exist");
    assert.equal(wordmarkToken.value, "var(--foreground)", "wordmark foreground aliases warm-white --foreground");
});

test("tracking tokens: body/label scale stays normal; poster hero may tighten only", () => {
    const tracking = declarations(GLOBALS).filter((d) => d.name.startsWith("--tracking-"));
    assert.ok(tracking.length > 0, "no --tracking-* tokens found");
    const posterHero = tracking.find((d) => d.name === "--tracking-poster-hero");
    assert.ok(posterHero, "--tracking-poster-hero must exist for Concept A poster hero");
    const labelSemibold = tracking.find((d) => d.name === "--tracking-label-semibold");
    assert.ok(labelSemibold, "--tracking-label-semibold must exist for small semibold hub labels");
    const labelEm = parseFloat(labelSemibold!.value.replace(/em\s*$/, ""));
    assert.ok(
        Number.isFinite(labelEm) && labelEm <= 0 && labelEm >= -0.02,
        `--tracking-label-semibold=${labelSemibold!.value} — bounded negative sidebearing fix only`,
    );
    assert.match(
        GLOBALS,
        /letter-spacing:\s*var\(--tracking-label-semibold\)/,
        "label semibold tracking must apply via globals.css base layer, not per-component utilities",
    );
    const maxTightEm = 0.05;
    const maxLooseEm = 0.05;
    for (const { name, value } of tracking) {
        if (name === "--tracking-poster-hero") {
            const em = parseFloat(value.replace(/em\s*$/, ""));
            assert.ok(em <= 0 && em >= -0.06, `${name}=${value} — poster hero tracking only slightly tight`);
            continue;
        }
        if (name === "--tracking-label-semibold") {
            continue;
        }
        const em = parseFloat(value.replace(/em\s*$/, ""));
        assert.ok(
            Number.isFinite(em) && em >= -maxTightEm && em <= maxLooseEm,
            `${name}=${value} — body/label tracking tokens must stay near 0 (not poster hero)`,
        );
    }
});

test("wordmark lockup call sites: no local text-brand override on BrandLockup wrappers", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        if (isFileAllowed(readFileSync(file, "utf8"))) continue;
        const raw = readFileSync(file, "utf8");
        if (!raw.includes("BrandLockup")) continue;
        const lines = raw.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes("BrandLockup")) continue;
            const window = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
            if (/\btext-brand\b/.test(window) && !window.includes("design-lint-allow")) {
                offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `BrandLockup must not sit under a text-brand wrapper — warm white wordmark only: ${offenders.join("; ")}`,
    );
});

test("elevation is none: every --shadow-* scale key resolves to none", () => {
    const scaleKeys = tailwindShadowScaleKeys();
    const shadows = declarations(GLOBALS).filter((d) => scaleKeys.has(d.name));

    assert.ok(shadows.length > 0, "no --shadow-* scale tokens found — did the scale move?");
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

test("elevation is none: no key in Tailwind's scale is left undeclared", () => {
    // The assertion above can only speak for keys this repo wrote down, and
    // `shadow-2xl` was never written down — so Tailwind's stock
    // `0 25px 50px -12px` kept rendering on seven surfaces while the file above
    // it said elevation was none. Reading the framework's own theme means the
    // rule covers keys nobody here has heard of yet, including ones a future
    // Tailwind release adds.
    const shipped = tailwindShadowScaleKeys();
    const declared = new Set(
        declarations(GLOBALS)
            .filter((d) => shipped.has(d.name))
            .map((d) => d.name),
    );
    const missing = [...shipped].filter((k) => !declared.has(k));

    assert.deepEqual(
        missing,
        [],
        `Tailwind ships ${missing.join(", ")} with a real shadow and globals.css never ` +
            `overrides it, so those utilities still cast one. Add "<key>: none".`,
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

test("primary filled chrome aliases brand — body ink stays on --foreground", () => {
    for (const scope of ["root", "dark"] as const) {
        const selector = scope === "root" ? ":root" : "\\.dark";
        const start = GLOBALS.search(new RegExp(`^${selector}\\s*\\{`, "m"));
        assert.ok(start >= 0, `no ${scope} block in globals.css`);
        const block = GLOBALS.slice(start, GLOBALS.indexOf("\n}", start));
        assert.match(
            block,
            /--primary:\s*var\(--brand\)/,
            `${scope}: --primary must alias --brand so filled CTAs match logo navy`,
        );
        assert.match(
            block,
            /--primary-foreground:\s*var\(--brand-foreground\)/,
            `${scope}: --primary-foreground must alias --brand-foreground on green fills`,
        );
        assert.match(
            block,
            /--foreground:\s*(?!var\(--brand\))/,
            `${scope}: --foreground must remain body ink, not brand`,
        );
    }
});

test("every renderer of the brand mark sources its geometry from BrandMark.tsx", () => {
    // The dot-drift bug this file used to guard (five renderers hand-copying a
    // colour that then went stale) doesn't apply post-rebrand — the va-ligature
    // mark (2026-08-27) carries no dot, so there is no per-renderer colour to
    // drift. What still matters, and what actually broke before, is renderers
    // hand-copying the PATH geometry itself instead of importing it — so guard
    // that class of drift instead of a token this design no longer has.
    const offenders: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.tsx?$/.test(entry) && full !== path.join(ROOT, "src/components/brand/BrandMark.tsx")) {
                const src = readFileSync(full, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                // A literal `d="M ..."` path string that wasn't sourced from
                // BRAND_MARK_PATHS — i.e. the mark's own SVG commands, hand-pasted.
                if (/d="M 52 50 H 30/.test(src) && !/BRAND_MARK_PATHS/.test(src)) {
                    offenders.push(path.relative(ROOT, full));
                }
            }
        }
    };
    walk(path.join(ROOT, "src"));

    assert.deepEqual(
        offenders,
        [],
        `hardcoded mark path in: ${offenders.join(", ")} — import BRAND_MARK_PATHS instead.`,
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

/**
 * Guards docs/design/ATTENTION.md's elevation rule: a shadow means "this
 * floats above the page." Overlays (portal-rendered, nothing behind them)
 * cast exactly one standard shadow via the --shadow-overlay token; every
 * in-flow surface is flat and separates by border + whitespace, and its
 * hover affordance is border-darkening, never a lift.
 *
 * Classification is by VALUE SHAPE, not by an enumerated file list — a
 * future overlay primitive that correctly adopts shadow-[var(--shadow-overlay)]
 * must pass by construction, the same way a future in-flow component that
 * copies a hardcoded outer shadow must fail by construction. A hardcoded
 * filename allowlist would get either of those backwards.
 */

/** True for an inset sheen (surface finish — never judged as elevation). */
function isInsetShadowLayer(layer: string): boolean {
    return layer.trim().startsWith("inset");
}

/**
 * True for a zero-offset, zero-blur, spread-only ring — e.g.
 * `0 0 0 1px rgb(var(--foreground))`. This is box-shadow used to simulate a
 * border without affecting layout (a focus ring, an active-row outline); it
 * has no blur radius, so nothing "lifts," and it is exempt the same way a
 * literal `border` would be.
 */
function isRingShadowLayer(layer: string): boolean {
    return /^0(px)?[\s_]+0(px)?[\s_]+0(px)?[\s_]+[\d.]+px\b/.test(layer.trim());
}

/** True for a layer that uses a sanctioned semantic elevation token. */
function isSanctionedElevationShadowLayer(layer: string): boolean {
    return /^var\(--shadow-(?:overlay|postcard|surface-raised|bevel-highlight|bevel-inset)\)$/.test(
        layer.trim(),
    );
}

/**
 * True if a single box-shadow layer (CSS `box-shadow:` syntax, e.g.
 * "0 10px 30px 0 rgba(10,10,10,0.07)") is a forbidden outer elevation shadow.
 */
function isForbiddenOuterShadowLayer(layer: string): boolean {
    return (
        !isInsetShadowLayer(layer) &&
        !isRingShadowLayer(layer) &&
        !isSanctionedElevationShadowLayer(layer)
    );
}

/**
 * True if a Tailwind arbitrary shadow utility, e.g. "shadow-[0_8px_24px_rgba(0,0,0,0.1)]"
 * or "shadow-[var(--shadow-overlay)]", casts a forbidden outer elevation
 * shadow. Utility syntax joins a layer's components with underscores instead
 * of spaces, so it is normalised to space form before reusing the CSS-layer
 * classifier — one shape rule serves both syntaxes.
 */
function isForbiddenOuterShadowUtility(utility: string): boolean {
    const body = utility.match(/^shadow-\[(.+)\]$/)?.[1];
    if (!body) return false;
    return isForbiddenOuterShadowLayer(body.replace(/_/g, " "));
}

/**
 * True for a bare (non-arbitrary) Tailwind shadow utility naming a scale
 * step — e.g. `shadow-xs`, `shadow-2xl` — whose FRAMEWORK STOCK value casts a
 * forbidden outer shadow layer, judged by the exact same
 * `isForbiddenOuterShadowLayer` shape rule the arbitrary-value branch uses.
 * Judging the stock value (not this repo's zeroed one) is deliberate: the
 * `--shadow-*` scale is zeroed in globals.css, so `shadow-2xl` renders no
 * pixel today, but DESIGN-LANGUAGE.md's rule is "never a raw named-scale
 * shadow-* class" — using the name at all is the violation, independent of
 * whether a token override currently neuters it. `shadow-inner` survives
 * (its own stock value is itself an inset layer) and `shadow-none` survives
 * (no `--shadow-none` key exists in Tailwind's scale) without either being
 * special-cased here — both fall out of the shared shape rule for free, the
 * same "match on shape, not on an enumerated list" contract as the sibling
 * arbitrary-value classifier.
 */
function splitShadowLayers(value: string): string[] {
    // A box-shadow value is a comma-separated layer list; commas also occur
    // inside rgba()/var(), so only split on ones outside parens.
    return value.split(/,(?![^(]*\))/).map((s) => s.trim());
}

function isForbiddenNamedShadowPreset(utility: string, scaleDefaults: Map<string, string>): boolean {
    const step = utility.match(/^shadow-([a-z0-9]+)$/)?.[1];
    if (!step) return false;
    const stockValue = scaleDefaults.get(`--shadow-${step}`);
    if (!stockValue) return false; // shadow-none, or not a real Tailwind scale step
    return splitShadowLayers(stockValue).some(isForbiddenOuterShadowLayer);
}

test("no .glass-panel/.glass-card/.glass-tint-* CSS rule survives (Group A part 2 deletion)", () => {
    // Supersedes the old ".glass-panel/.glass-card never regain an outer
    // shadow" regression guard: that test asserted properties ABOUT a CSS
    // block (no box-shadow, no hover lift, no .dark duplicate). Group A part
    // 2 deletes the block outright — every call site now carries plain
    // `bg-card border border-border` utilities directly, which structurally
    // cannot regain a shadow/lift/`.dark` override (the "no blur/shadow"
    // and "no banned class" tests above already guard utility-class drift
    // class-wide) — so the invariant is now "the rule doesn't exist", not
    // "the rule stays shadow-free".
    assert.doesNotMatch(
        GLOBALS,
        /\.glass-(?:panel|card|panel-raised|panel-accent-top|tint-(?:blue|emerald|amber|purple|muted))\b/,
        "a .glass-* CSS rule reappeared in globals.css — the flat bg-card/border-border utility replacement should not regain a dedicated CSS class",
    );
});

test("shadow means floating: outer utility shadows only appear as the overlay token", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.tsx?$/.test(entry)) {
                files.push(full);
            }
        }
    };
    walk(path.join(ROOT, "src"));

    const scaleDefaults = tailwindShadowScaleDefaults();
    const offenders: string[] = [];
    const namedPresetOffenders: string[] = [];
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/shadow-\[[^\]]*\]/g)) {
            if (isForbiddenOuterShadowUtility(m[0])) {
                offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`);
            }
        }
        // Named-preset half of the same rule (`shadow-sm`/`shadow-xl`/... —
        // no brackets): classified by `isForbiddenNamedShadowPreset`, the
        // SAME shape rule as the arbitrary-value branch above, just applied
        // to a scale step's stock value instead of a literal one. This is
        // the exact gap that let `shadow-2xl` survive in a job-details modal
        // — the arbitrary-value regex above never matches a bracket-free
        // class name.
        for (const m of src.matchAll(/shadow-[a-z0-9]+\b/g)) {
            if (isForbiddenNamedShadowPreset(m[0], scaleDefaults)) {
                const line = src.slice(0, m.index).split("\n").length;
                namedPresetOffenders.push(`${path.relative(ROOT, file)}:${line}: ${m[0]}`);
            }
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `outer elevation shadow(s) outside the sanctioned overlay token: ${offenders.join("; ")}. ` +
            `In-flow elements are flat (border + whitespace); floating overlays use shadow-[var(--shadow-overlay)].`,
    );

    // The named-preset half ratchets against a baseline instead of a hard
    // zero, the same shrink-only contract as module-adoption-baseline.json:
    // ~70 call sites across the app predate this half of the guard, and
    // fixing all of them is a separate, deliberate PR, not fallout from
    // closing the /co modal's gap. A NEW named-preset offender not already
    // in the baseline still fails this test by name.
    const baselinePath = path.join(__dirname, "shadow-preset-baseline.json");
    const baseline: string[] = JSON.parse(readFileSync(baselinePath, "utf8")).offenders;
    const baselineSet = new Set(baseline);
    const currentSet = new Set(namedPresetOffenders);
    const newNamedPresetOffenders = namedPresetOffenders.filter((o) => !baselineSet.has(o));
    const staleBaselineEntries = baseline.filter((o) => !currentSet.has(o));

    if (staleBaselineEntries.length) {
        console.log(
            `shadow-preset-baseline: ${staleBaselineEntries.length} entr${staleBaselineEntries.length === 1 ? "y" : "ies"} ` +
                `no longer cast a named-preset shadow — safe to remove from tests/unit/shadow-preset-baseline.json: ` +
                `${staleBaselineEntries.join(", ")}`,
        );
    }

    assert.deepEqual(
        newNamedPresetOffenders,
        [],
        `${newNamedPresetOffenders.length} new named-preset outer shadow(s): ${newNamedPresetOffenders.join("; ")}. ` +
            `Go flat / border, adopt shadow-[var(--shadow-overlay)] if this is a true overlay, or — only for a ` +
            `surface genuinely outside this change's scope — add it to tests/unit/shadow-preset-baseline.json.`,
    );

});

test("shadow classifier: survives an inset sheen, catches a hardcoded outer shadow", () => {
    // Proves the guard above is shape-based and class-wide, not a record of
    // the specific instances this change fixed.
    assert.equal(
        isForbiddenOuterShadowUtility("shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)]"),
        false,
        "an inset sheen in a non-overlay file must survive — it is surface finish, not elevation",
    );
    assert.equal(
        isForbiddenOuterShadowUtility("shadow-[0_0_0_1px_rgb(var(--foreground))]"),
        false,
        "a zero-blur spread-only ring must survive — it simulates a border, not elevation",
    );
    assert.equal(
        isForbiddenOuterShadowUtility("shadow-[var(--shadow-overlay)]"),
        false,
        "the sanctioned overlay token must survive anywhere it's used",
    );
    assert.equal(
        isForbiddenOuterShadowUtility("shadow-[var(--shadow-postcard)]"),
        false,
        "the sanctioned postcard token must survive on landing surfaces",
    );
    // A violation fixture other than any instance this change touched: a
    // hypothetical card component hardcoding its own drop shadow instead of
    // going flat or adopting the token.
    assert.equal(
        isForbiddenOuterShadowUtility("shadow-[0_4px_14px_rgba(0,0,0,0.18)]"),
        true,
        "a hardcoded outer drop shadow must be caught",
    );
});

test("shadow classifier: named presets follow the same rule as arbitrary values", () => {
    // Proves the named-preset half is shape-based too, not a hardcoded list
    // of the sizes this change happened to touch — a case other than
    // `shadow-2xl` (the modal instance that motivated this) has to fail too.
    const scaleDefaults = tailwindShadowScaleDefaults();
    assert.equal(
        isForbiddenNamedShadowPreset("shadow-2xl", scaleDefaults),
        true,
        "shadow-2xl is the instance that motivated this — must still be caught",
    );
    assert.equal(
        isForbiddenNamedShadowPreset("shadow-xs", scaleDefaults),
        true,
        "shadow-xs's stock value is a real outer drop shadow (not inset, not a ring) and must fail too",
    );
    assert.equal(
        isForbiddenNamedShadowPreset("shadow-none", scaleDefaults),
        false,
        "shadow-none is a legitimate explicit no-op — no --shadow-none key exists to flag",
    );
    assert.equal(
        isForbiddenNamedShadowPreset("shadow-inner", scaleDefaults),
        false,
        "shadow-inner's own stock value is itself an inset layer, exempt the same way arbitrary insets are",
    );
});

test("/co: no rounded-2xl/rounded-3xl survives in the company-page family", () => {
    // DESIGN-LANGUAGE.md's radius rule ("All nine --radius-* keys are 0px")
    // already renders these classes at 0px — this guards the code-hygiene
    // half, the same reasoning the shadow guard above applies to shadow-2xl:
    // a component naming a size that does nothing reads as a lie to the next
    // person editing it. Scoped to the company-page family (the /co route
    // plus every src/components/company/*.tsx file, whether or not /co is
    // the one that renders it) rather than all of src, because the rest of
    // the app hasn't been swept yet — one surface's ratchet, not a repo-wide
    // rewrite in this change.
    const targets = [
        path.join(ROOT, "src/app/co/[slug]/page.tsx"),
        ...readdirSync(path.join(ROOT, "src/components/company"))
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => path.join(ROOT, "src/components/company", f)),
    ];

    const offenders: string[] = [];
    for (const file of targets) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/\brounded-(2xl|3xl)\b/g)) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(`${path.relative(ROOT, file)}:${line}: ${m[0]}`);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `rounded-2xl/rounded-3xl surviving in the company-page family: ${offenders.join("; ")}. ` +
            `Every --radius-* key is 0px already — drop the class (or use rounded-none where dropping it ` +
            `would leave the element non-square by default).`,
    );
});

/**
 * Repo-wide static gate for docs/design/DESIGN-LANGUAGE.md's mechanical
 * rules — the same categories the one-time src/-wide sweep fixed by hand in
 * this change, kept from silently regressing one class at a time. Matches on
 * class SHAPE (a Tailwind utility name/value pattern), never an enumerated
 * file list, so a new component is covered by construction.
 *
 * Two exemption markers, both living in a comment so they must be looked up
 * against RAW (unstripped) source — comment-stripping first would make a
 * marker permanently invisible to its own exemption check:
 *   - `// design-lint-allow` within ALLOW_WINDOW_LINES lines above a match
 *     exempts that one line (e.g. BrandMark.tsx's wordmark, the one
 *     rulebook-sanctioned uppercase/tracking exception).
 *   - `design-lint-allow-file` anywhere in a file exempts the whole file
 *     (decorative mockups whose intentional raw values are too dense/
 *     scattered for a per-line marker).
 */

// Walk/exemption plumbing AND the banned-class rule table both now live in
// scripts/design/banned-classes.cjs — the same functions this test used to
// define locally, moved so scripts/design/sweep-banned-classes.cjs can share
// them instead of re-implementing an identical walk/exemption scan (Group A
// part 2). `require`, not `import`: a bare `require(str)` call resolves to
// `any` under @types/node with no module-resolution step, so a .cjs sibling
// with no .d.ts can't trip module resolution the way an ESM `import` would.
// The destructure below is still explicitly typed — an untyped `any` doesn't
// trip resolution, but it DOES lose contextual parameter typing for any
// inline callback passed to `findOffenders` (a bare `(line) => ...` becomes
// an implicit-any parameter, which `tsc --noEmit` correctly flags).
type BannedRule = { name: string; pattern: RegExp; skip?: (line: string) => boolean };
const {
    rules: bannedClasses,
    ALLOW_WINDOW_LINES,
    EXCLUDED_DIRS,
    FILE_EXEMPTIONS,
    arbitrarySpacingLiteral,
    arbitraryColorLiteral,
    walkTsxFiles,
    stripComments,
    isFileAllowed,
    isLineAllowed,
    isScrimLine,
    findOffenders,
}: {
    rules: BannedRule[];
    ALLOW_WINDOW_LINES: number;
    EXCLUDED_DIRS: Set<string>;
    FILE_EXEMPTIONS: { file: string; why: string }[];
    arbitrarySpacingLiteral: RegExp;
    arbitraryColorLiteral: RegExp;
    walkTsxFiles: (dir: string) => string[];
    stripComments: (src: string) => string;
    isFileAllowed: (raw: string) => boolean;
    isLineAllowed: (rawLines: string[], lineIdx: number) => boolean;
    isScrimLine: (line: string) => boolean;
    findOffenders: (dir: string, pattern: RegExp, opts?: { skip?: (line: string, rawLine?: string) => boolean }) => string[];
} = require("../../scripts/design/banned-classes.cjs");

test("no arbitrary text-size or leading value survives outside an allow marker", () => {
    const offenders = [
        ...findOffenders(path.join(ROOT, "src"), /\btext-\[[0-9.]+(?:px|rem|em)\]/),
        ...findOffenders(path.join(ROOT, "src"), /\bleading-\[[0-9.]+(?:px|rem|em)\]/),
    ];
    assert.deepEqual(
        offenders,
        [],
        `arbitrary text-size/leading value(s): ${offenders.join("; ")}. Round to the nearest scale rung ` +
            `(12/16 · 14/20 · 16/22 · 20/28, or the expressive 28/36 · 32/40 · 42/50).`,
    );
});

test("no uppercase or tracking-* utility survives outside the wordmark exemption", () => {
    const offenders = [
        ...findOffenders(path.join(ROOT, "src"), /\buppercase\b/),
        ...findOffenders(path.join(ROOT, "src"), /\btracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]]+\])/),
    ];
    assert.deepEqual(
        offenders,
        [],
        `uppercase/tracking-* survives: ${offenders.join("; ")}. Rulebook: sentence case, normal tracking ` +
            `everywhere except the wordmark (data-rulebook-exempt + design-lint-allow).`,
    );
});

test("no retired font weight survives", () => {
    const offenders = [
        ...findOffenders(path.join(ROOT, "src"), /\bfont-medium\b/),
        ...findOffenders(path.join(ROOT, "src"), /\bfont-(?:bold|extrabold|black)\b/),
    ];
    assert.deepEqual(
        offenders,
        [],
        `retired font weight survives: ${offenders.join("; ")}. Only font-normal/font-semibold (400/600) remain.`,
    );
});

test("no blur, backdrop-blur, drop-shadow, or arbitrary shadow utility survives", () => {
    // shadow-[var(--shadow-overlay)] is the one sanctioned non-zero shadow —
    // the same overlay token the "outer utility shadows" test above requires
    // on every floating portal primitive — so it's exempt by its exact
    // value, not by file, mirroring the scrim carve-out for translucency. A
    // line skips only when EVERY banned-pattern match on it is that token,
    // so a real violation sharing a line with the token still gets caught.
    const bannedBlurShadow = /\b(?:backdrop-blur(?:-\[[^\]]*\]|-[a-zA-Z0-9]+)?|blur(?:-\[[^\]]*\]|-[a-zA-Z0-9]+)?|drop-shadow(?:-\[[^\]]*\]|-[a-zA-Z0-9]+)?|shadow-\[[^\]]*\])\b/g;
    const offenders = findOffenders(path.join(ROOT, "src"), bannedBlurShadow, {
        skip: (strippedLine) => {
            const matches = strippedLine.match(bannedBlurShadow) ?? [];
            return matches.length > 0 && matches.every((m) => m === "shadow-[var(--shadow-overlay)]");
        },
    });
    assert.deepEqual(
        offenders,
        [],
        `blur/shadow utility survives: ${offenders.join("; ")}. No blur, no drop-shadow, no arbitrary shadow — ` +
            `elevation is border + whitespace (see the outer-shadow guard above for named-preset shadow-*).`,
    );
});

test("no raw Tailwind palette class survives — every colour resolves to a semantic role", () => {
    const prefixes = ["bg", "text", "border", "ring", "divide", "outline", "decoration", "fill", "stroke", "accent", "caret", "from", "via", "to", "placeholder"];
    const families = ["slate", "gray", "zinc", "neutral", "stone", "blue", "indigo", "sky", "violet", "purple", "green", "emerald", "teal", "amber", "yellow", "orange", "red", "rose", "pink"];
    const offenders = findOffenders(path.join(ROOT, "src"), new RegExp(`\\b(?:${prefixes.join("|")})-(?:${families.join("|")})-[0-9]+\\b`));
    assert.deepEqual(
        offenders,
        [],
        `raw palette class survives: ${offenders.join("; ")}. Use a semantic token (brand/live/warn/danger-text/` +
            `muted/muted-foreground/border/foreground/placeholder-text) instead of a raw Tailwind colour name.`,
    );
});

test("no banned class from the shared rule table survives (Group A part 2)", () => {
    // ONE rule table, two consumers: scripts/design/banned-classes.cjs feeds
    // both this gate and scripts/design/sweep-banned-classes.cjs. Adding a
    // new banned-class family means adding one entry there — this test needs
    // no changes to cover it. Supersedes the old hand-rolled "no
    // opacity-modified colour survives" test, whose prefix-[a-zA-Z]+ pattern
    // couldn't match a hyphenated compound role name (text-muted-foreground,
    // border-verdict-good) and so missed most of its own family; that family
    // is now `bannedClasses`' "colour/NN opacity suffix" entry instead.
    const offenders: string[] = [];
    for (const rule of bannedClasses) {
        const found = findOffenders(path.join(ROOT, "src"), rule.pattern, { skip: rule.skip });
        offenders.push(...found.map((o) => `[${rule.name}] ${o}`));
    }
    assert.deepEqual(
        offenders,
        [],
        `banned class(es) survive: ${offenders.join("; ")}. Run ` +
            `\`node scripts/design/sweep-banned-classes.cjs\` to fix mechanically, or add a ` +
            `design-lint-allow / design-lint-allow-file marker for a deliberate exception.`,
    );
});

test("no arbitrary rounded-[...] radius survives (rounded-[inherit] is exempt by shape)", () => {
    const offenders = findOffenders(path.join(ROOT, "src"), /\brounded(?:-[tblrse]{1,2})?-\[[0-9.]+(?:px|rem|em|%)\]/);
    assert.deepEqual(
        offenders,
        [],
        `arbitrary rounded-[...] radius survives: ${offenders.join("; ")}. Every --radius-* key is 0px — use ` +
            `rounded-none, or a keyword value (rounded-[inherit]) which this rule does not flag.`,
    );
});

// `.test()` on a shared global-flagged RegExp mutates `lastIndex` across
// calls (both exported classifiers carry `g`, needed by findOffenders'
// `.match()` scan, which is stateless); `String.match()` isn't, so fixture
// checks below go through it instead of `.test()` directly.
const flags = (re: RegExp, s: string): boolean => s.match(re) !== null;

test("arbitrary spacing literal classifier: shape-based, proven on fixtures other than the real sites", () => {
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="pl-[1.375rem]">'), true, "a plain rem literal must be flagged");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="ml-[calc(0.875rem+0.5rem)]">'), true, "a calc() literal re-spelling a banned value must still be flagged");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="top-[52px]">'), true, "a px literal must be flagged");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="gap-[2px]">'), true, "a px literal must be flagged");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="-mt-[3px]">'), true, "a negative-prefix spacing literal must be flagged");
    assert.equal(
        flags(arbitrarySpacingLiteral, '<div className="pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))]">'),
        false,
        "a calc() composing token(s) with env() anywhere in the bracket is a composition, not a literal, even though it doesn't start with var(--",
    );
    assert.equal(
        flags(arbitrarySpacingLiteral, '<div className="bottom-[calc(var(--x)+8px)]">'),
        false,
        "a calc() composing a token with a literal offset is still a composition by shape — the token reference need not be the whole bracket",
    );
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="top-[env(safe-area-inset-top)]">'), false, "env() alone is a live inset reference, not a literal");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="pt-[var(--topbar-h)]">'), false, "a bracket value composing an existing CSS custom property is a token reference, not a literal");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="pl-6">'), false, "a scale rung must not be flagged");
    assert.equal(flags(arbitrarySpacingLiteral, '<div className="grid-cols-[auto_1fr]">'), false, "a non-spacing prefix sharing the -[...] shape must not be flagged");
});

test("no arbitrary spacing utility with a literal value survives outside an allow marker", () => {
    const offenders = findOffenders(path.join(ROOT, "src"), arbitrarySpacingLiteral);
    assert.deepEqual(
        offenders,
        [],
        `arbitrary spacing literal(s): ${offenders.join("; ")}. Round to the nearest 4px scale rung, compose ` +
            `an existing CSS custom property (pt-[var(--topbar-h)]), or restructure the markup so no literal is ` +
            `needed at all.`,
    );
});

test("arbitrary colour literal classifier: shape-based, proven on fixtures other than the real sites", () => {
    assert.equal(flags(arbitraryColorLiteral, '<div className="bg-[rgba(18,21,26,0.42)]">'), true, "an rgba() literal must be flagged");
    assert.equal(flags(arbitraryColorLiteral, '<div className="text-[#c5ccd6]">'), true, "a hex literal must be flagged");
    assert.equal(flags(arbitraryColorLiteral, '<div className="border-[hsl(210,10%,50%)]">'), true, "an hsl() literal must be flagged");
    assert.equal(flags(arbitraryColorLiteral, '<div className="bg-[var(--scrim)]">'), false, "a bracket value composing an existing CSS custom property is a token reference, not a literal");
    assert.equal(flags(arbitraryColorLiteral, '<div className="bg-border">'), false, "a semantic token class must not be flagged");
});

test("no arbitrary colour literal survives outside an allow marker or a FILE_EXEMPTIONS entry", () => {
    const offenders = findOffenders(path.join(ROOT, "src"), arbitraryColorLiteral);
    assert.deepEqual(
        offenders,
        [],
        `arbitrary colour literal(s): ${offenders.join("; ")}. Substitute an existing token (bg-card, text-foreground, ` +
            `outline-brand, ...), compose one with var(--token), or add a reasoned FILE_EXEMPTIONS entry for a ` +
            `self-contained surface with its own fixed palette.`,
    );
});

test("scrim/allow classifiers: shape-based, proven on fixtures other than the real sites", () => {
    assert.equal(isScrimLine('<div className="fixed inset-0 z-50 bg-black/60" />'), true, "fixed + inset-0 + bg-black/NN is the sanctioned scrim shape");
    assert.equal(isScrimLine('<div className="fixed top-4 right-4 bg-black/60" />'), false, "fixed without inset-* must not read as a scrim");
    assert.equal(isScrimLine('<div className="inset-0 bg-black/60" />'), false, "inset-0 without fixed must not read as a scrim");
    assert.equal(isScrimLine('<div className="fixed inset-0 bg-brand/60" />'), false, "a non-black/white opacity colour is not the sanctioned scrim");

    // Window is 6 lines ending at (and including) the match line, so a marker
    // at index 0 is inside the window for a match at index 5 (6 lines: 0..5)
    // and just outside it for a match at index 6 (window becomes 1..6).
    const fixtureLines = ["// design-lint-allow", "b", "c", "d", "e", "f — 5 lines below the marker", "g — 6 lines below the marker"];
    assert.equal(isLineAllowed(fixtureLines, 5), true, "marker 5 lines above the match falls inside the 6-line window");
    assert.equal(isLineAllowed(fixtureLines, 6), false, "marker 6 lines above the match falls outside the 6-line window");
    assert.equal(isLineAllowed(["x", "// design-lint-allow-file"], 0), false, "the file-level marker must not also satisfy a line-level lookup");
});

test("FILE_EXEMPTIONS is the complete, exact set of design-lint-allow-file files", () => {
    // The whole-file marker is itself an escape hatch from every rule above —
    // this ratchet is what keeps that escape hatch from growing unreviewed.
    // A new `design-lint-allow-file` marker with no matching FILE_EXEMPTIONS
    // entry (or vice versa) fails here instead of silently widening the gate.
    const markedFiles = walkTsxFiles(path.join(ROOT, "src"))
        .filter((f) => isFileAllowed(readFileSync(f, "utf8")))
        .map((f) => path.relative(ROOT, f))
        .sort();
    const declaredFiles = FILE_EXEMPTIONS.map((e) => e.file).sort();
    assert.deepEqual(
        markedFiles,
        declaredFiles,
        `design-lint-allow-file marker(s) and banned-classes.cjs's FILE_EXEMPTIONS list have drifted apart — ` +
            `marked: [${markedFiles.join(", ")}], declared: [${declaredFiles.join(", ")}]. Add/remove the file on ` +
            `both sides together.`,
    );
});

/**
 * Loading placeholders are quiet rectangles (rulebook v2, Sep 2026): a
 * skeleton is a flat layer block that pulses. What broke this was ONE CSS
 * class (`.skeleton-bar`, 30 call sites) painting a moving gradient — so the
 * guard reads every rule in globals.css rather than one class name: a rule
 * that both animates and paints a gradient is a shimmer, and a keyframes
 * block that moves background-position is a sweep, whatever either is called.
 */
function shimmerRules(css: string): string[] {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().split("\n").pop()!.trim();
        if (/animation(?:-name)?\s*:/.test(m[2]) && /gradient\(/.test(m[2])) offenders.push(selector);
    }
    for (const m of src.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{([\s\S]*?)\}\s*\}/g)) {
        if (/background-position\s*:/.test(m[2])) offenders.push(`@keyframes ${m[1]}`);
    }
    return offenders;
}

test("loading placeholders are flat: no rule in globals.css animates a gradient or sweeps background-position", () => {
    assert.deepEqual(
        shimmerRules(GLOBALS),
        [],
        "a shimmer/sweep survives in globals.css — placeholders are flat bg-muted blocks that pulse (see .skeleton-bar and ui/skeleton.tsx)",
    );
});

test("shimmer classifier: catches a sweep and an animated gradient under any name, passes a flat pulse", () => {
    const fixture = `
.card-ghost { background-image: linear-gradient(90deg, transparent, rgb(0 0 0 / .06), transparent); animation: sweep 1s infinite; }
@keyframes sweep { from { background-position: 200% 0; } 50% { opacity: .9; } to { background-position: -200% 0; } }
.quiet { background-color: rgb(var(--muted)); animation: var(--animate-pulse); }
@keyframes pulse { 50% { opacity: .5; } }
/* .commented-out { background: linear-gradient(red, blue); animation: x 1s; } */`;
    assert.deepEqual(shimmerRules(fixture), [".card-ghost", "@keyframes sweep"]);
});

// ─── Icon sizes (rulebook v2 clause 6: 16 · 20 in a 40px control · 24 display) ──
// Detection lives in scripts/design/icon-sizes.cjs next to its `--apply`
// codemod, so the gate and the fix share one import-aware scanner: only JSX
// tags imported from @phosphor-icons/react are inspected, never a `size` prop
// on some other component. Same `require` reasoning as banned-classes above.
const { scanSource: scanIconSizes, findIconSizeOffenders } = require("../../scripts/design/icon-sizes.cjs") as {
    scanSource: (src: string, filePath?: string) => { offenders: { line: number; tag: string; detail: string }[]; rewritten: string };
    findIconSizeOffenders: (dir: string) => string[];
};

test("icons are 16/20/24: no Phosphor element under src/ carries another size prop or a sub-16px Tailwind size", () => {
    assert.deepEqual(findIconSizeOffenders(path.join(ROOT, "src")), []);
});

test("icon-size classifier: catches small, large and Tailwind-sized icons; leaves allowed sizes and non-icon size props alone", () => {
    const fixture = [
        'import { Bell, Check } from "@phosphor-icons/react";',
        'import { Avatar } from "@/components/ui/avatar";',
        "export const X = () => (<>",
        '  <Check size={12} className="h-3 w-3 shrink-0" />',
        '  <Bell size={20} weight="fill" />',
        '  <Bell size={40} className="text-brand" />',
        "  <Avatar size={12} />",
        "</>);",
    ].join("\n");
    const { offenders, rewritten } = scanIconSizes(fixture);
    assert.deepEqual(offenders.map((o) => `${o.line} ${o.tag} ${o.detail}`), [
        '4 Check size 12→default(16); className "h-3 w-3 shrink-0"→"shrink-0"',
        "6 Bell size 40→24",
    ]);
    assert.match(rewritten, /<Check className="shrink-0" \/>/);
    assert.match(rewritten, /<Bell size=\{20\} weight="fill" \/>/);
    assert.match(rewritten, /<Bell size=\{24\} className="text-brand" \/>/);
    assert.match(rewritten, /<Avatar size=\{12\} \/>/);
});

test("icon-size classifier: an ssr-entry icon gets the explicit 16px + bold that IconDefaultsProvider cannot reach", () => {
    const fixture = 'import { House } from "@phosphor-icons/react/dist/ssr";\nexport const Y = () => <House size={14} />;';
    const { offenders, rewritten } = scanIconSizes(fixture);
    assert.deepEqual(offenders.map((o) => o.detail), ['size 14→16 (ssr entry, explicit); ssr entry: weight="bold" added']);
    assert.match(rewritten, /<House size=\{16\} weight="bold" \/>/);
});

test("icon-size classifier: follows one level of local indirection through an icon lookup map (fact-chip-icons.tsx's own shape), catching both a member-expression tag and a computed-lookup local var — not just a bare imported tag name", () => {
    // A minimal stand-in for src/components/jobs/fact-chip-icons.tsx: an
    // object literal whose every value is a name imported from the phosphor
    // package. The classifier must recognize this SHAPE, not this file's name.
    const mapModuleSrc = [
        'import { MapPin, House } from "@phosphor-icons/react";',
        "export const TEST_ICON_MAP = { a: MapPin, b: House };",
    ].join("\n");
    const dir = mkdtempSync(path.join(os.tmpdir(), "icon-map-fixture-"));
    const mapFile = path.join(dir, "icon-map.tsx");
    writeFileSync(mapFile, mapModuleSrc);
    try {
        const consumerSrc = [
            'import { TEST_ICON_MAP } from "./icon-map";',
            "export const X = () => (<>",
            "  <TEST_ICON_MAP.a size={12} />",
            "  {(() => { const Icon = TEST_ICON_MAP[chip.kind]; return <Icon size={18} />; })()}",
            "</>);",
        ].join("\n");
        const consumerFile = path.join(dir, "consumer.tsx");
        writeFileSync(consumerFile, consumerSrc);
        const { offenders } = scanIconSizes(consumerSrc, consumerFile);
        assert.deepEqual(offenders.map((o) => `${o.line} ${o.tag} ${o.detail}`), [
            "3 TEST_ICON_MAP.a size 12→default(16)",
            "4 Icon size 18→default(16)",
        ]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("icon-size classifier: also catches the destructured-lookup form `const { key: Icon } = Map`", () => {
    const mapModuleSrc = [
        'import { MapPin, House } from "@phosphor-icons/react";',
        "export const TEST_ICON_MAP = { a: MapPin, b: House };",
    ].join("\n");
    const dir = mkdtempSync(path.join(os.tmpdir(), "icon-map-destructure-fixture-"));
    writeFileSync(path.join(dir, "icon-map.tsx"), mapModuleSrc);
    try {
        const consumerSrc = [
            'import { TEST_ICON_MAP } from "./icon-map";',
            "const { a: Icon } = TEST_ICON_MAP;",
            "export const X = () => <Icon size={12} />;",
        ].join("\n");
        const consumerFile = path.join(dir, "consumer.tsx");
        writeFileSync(consumerFile, consumerSrc);
        const { offenders } = scanIconSizes(consumerSrc, consumerFile);
        assert.deepEqual(offenders.map((o) => `${o.line} ${o.tag} ${o.detail}`), ["3 Icon size 12→default(16)"]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ─── Gradient paints (rulebook: depth = tint step or hairline, zero gradients) ──
// Guards the gap the /jobs results-page wash slipped through: the class
// sweep above reads Tailwind CLASS NAMES and the computed-style probe (run
// separately) reads background-color, so neither ever looks at a gradient
// PAINT. The one gradient shape still sanctioned is a FADE to/from the page
// itself (transparent, white, or the --background/--card token) — never one
// that carries a brand/token/hex colour into the page. Classification is by
// the colour VALUE at each stop, never by which component/file wrote it, so
// a new gradient anywhere in src/ is covered by construction.

/** True when a trimmed gradient stop OPENS with something colour-shaped (a
 *  keyword, hex, rgb()/rgba()/hsl()/hsla(), or a var(--token)) — as opposed
 *  to a geometry/direction segment ("to right", "ellipse 80% 40% at 50% -10%",
 *  a bare angle) that carries no colour to judge at all. */
function isGradientColorStop(stop: string): boolean {
    return /^(?:transparent\b|white\b|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(--)/i.test(stop);
}

/** True when a colour stop is page-coloured: transparent, white (keyword,
 *  hex, or an rgb/rgba white at any alpha), or the --background/--card token
 *  (bare or rgb()-wrapped). Anything else that reached here already passed
 *  `isGradientColorStop`, so it is a real colour — a tint. */
function isPageColorStop(stop: string): boolean {
    return (
        /^transparent\b/i.test(stop) ||
        /^white\b/i.test(stop) ||
        /^#fff(?:fff)?\b/i.test(stop) ||
        /^rgba?\(\s*255[,\s]+255[,\s]+255\s*[,/]/i.test(stop) ||
        /^var\(--(?:background|card)\)/.test(stop) ||
        /^rgb\(\s*var\(--(?:background|card)\)\s*\)/.test(stop)
    );
}

/** True for a bare (non-arbitrary) Tailwind from-/via-/to- stop whose colour
 *  is page-coloured — the same vocabulary `isPageColorStop` allows for a CSS
 *  gradient, spelled as Tailwind stop utilities instead. */
function isAllowedTailwindStop(token: string): boolean {
    return /^(?:from|via|to)-(?:card|background|white|transparent)(?:\/[0-9]{1,3})?$/.test(token);
}

/** Splits a gradient's argument list on commas OUTSIDE any parens, tracking
 *  nesting depth exactly — rather than the single-level lookahead the shadow
 *  classifier above uses — because a stop like `rgb(var(--brand) / 0.12)`
 *  nests a var() inside an rgb(), one level deeper than a shadow layer. */
function splitTopLevelCommas(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
        else if (value[i] === "," && depth === 0) {
            parts.push(value.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(value.slice(start));
    return parts;
}

/** Extracts the argument list of every linear-/radial-/conic-gradient(...)
 *  call in `source`, matching parens by depth so a nested rgb(var(...))
 *  doesn't truncate the extraction. Underscores are normalised to spaces
 *  first: Tailwind's arbitrary-value bracket syntax (`[mask-image:...]`)
 *  writes a space as `_`, which would otherwise defeat the `\b`-anchored
 *  colour-start checks (`transparent_0%` has no word boundary after
 *  "transparent"). CSS colour/geometry syntax never uses a literal
 *  underscore, so the substitution is safe. */
function extractGradientArgs(source: string): string[] {
    const args: string[] = [];
    const fnRe = /(?:linear|radial|conic)-gradient\(/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(source))) {
        const openIdx = m.index + m[0].length - 1;
        let depth = 1;
        let i = openIdx + 1;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
        }
        args.push(source.slice(openIdx + 1, i - 1).replace(/_/g, " "));
        fnRe.lastIndex = i;
    }
    return args;
}

/**
 * Returns every offending colour stop in `source` — a CSS gradient stop or a
 * Tailwind from-/via-/to- stop that isn't page-coloured. A gradient that
 * only fades to/from transparent/white/--background/--card returns [].
 * Shape-based on both syntaxes a gradient can be written in this repo:
 *   (a) a real CSS `linear-|radial-|conic-gradient(...)` (inline style,
 *       Tailwind arbitrary-value bracket, or a .css rule);
 *   (b) a Tailwind `from-*`/`via-*`/`to-*` utility, judged only when it
 *       shares a quoted class-string literal with a `bg-gradient-` utility
 *       — a bare `from-*` with no gradient utility active paints nothing.
 */
function findTintedGradients(source: string): string[] {
    const offenders: string[] = [];

    for (const args of extractGradientArgs(source)) {
        for (const rawStop of splitTopLevelCommas(args)) {
            const stop = rawStop.trim();
            if (isGradientColorStop(stop) && !isPageColorStop(stop)) offenders.push(stop);
        }
    }

    for (const literal of source.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
        const content = literal[1] ?? literal[2] ?? literal[3] ?? "";
        if (!/\bbg-gradient-/.test(content)) continue;
        for (const token of content.matchAll(/(?<!gradient-)\b(?:from|via|to)-[a-zA-Z][a-zA-Z0-9-]*(?:\/[0-9]{1,3})?\b/g)) {
            if (!isAllowedTailwindStop(token[0])) offenders.push(token[0]);
        }
    }

    return offenders;
}

test("gradients are fades, never tints: no gradient paint under src/ carries a colour stop other than page/card/white/transparent", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (EXCLUDED_DIRS.has(full)) continue;
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.(?:tsx?|css)$/.test(entry)) {
                files.push(full);
            }
        }
    };
    walk(path.join(ROOT, "src"));

    const offenders: string[] = [];
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        if (isFileAllowed(src)) continue;
        for (const stop of findTintedGradients(src)) {
            offenders.push(`${path.relative(ROOT, file)}: ${stop}`);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `gradient paint carrying a non-page colour stop: ${offenders.join("; ")}. A gradient may only fade ` +
            `to/from transparent/white/the --background or --card token — anything else is a tint; use a flat ` +
            `token fill instead of a gradient wash.`,
    );
});

test("tinted-gradient classifier: catches brand/hex/Tailwind tints, passes page fades, ignores a from-* with no gradient utility", () => {
    // A brand/token radial tint — same SHAPE as the /jobs wash this change
    // removes, but a different site (circle vs ellipse, a different token).
    assert.deepEqual(
        findTintedGradients("background: radial-gradient(circle at 20% 20%, rgb(var(--accent) / 0.3), transparent 60%);"),
        ["rgb(var(--accent) / 0.3)"],
        "a token colour other than --background/--card inside a radial-gradient must be caught",
    );
    // A hex tint inside a linear-gradient.
    assert.deepEqual(
        findTintedGradients("background-image: linear-gradient(180deg, #1a73e8, transparent);"),
        ["#1a73e8"],
        "a hex tint inside a linear-gradient must be caught",
    );
    // A Tailwind gradient utility carrying a brand stop.
    assert.deepEqual(
        findTintedGradients('<div className="bg-gradient-to-t from-brand/20 to-transparent" />'),
        ["from-brand/20"],
        "a brand Tailwind gradient stop must be caught even though to-transparent beside it is fine",
    );
    // The sanctioned Tailwind fade (JobDetail.tsx's real shape).
    assert.deepEqual(
        findTintedGradients('<div className="bg-gradient-to-t from-card to-transparent" />'),
        [],
        "a card-to-transparent Tailwind fade is the sanctioned shape",
    );
    // The sanctioned CSS fade (WatchingWall.tsx's real mask shape).
    assert.deepEqual(
        findTintedGradients("mask-image: linear-gradient(to right, transparent, white 66%, rgba(255,255,255,0.45));"),
        [],
        "a transparent/white/rgba(255,255,255,...) mask fade is the sanctioned shape",
    );
    // Not a gradient stop at all: no bg-gradient- utility anywhere in the string.
    assert.deepEqual(
        findTintedGradients('<div className="from-emerald-500 text-white" />'),
        [],
        "a from-* class with no bg-gradient- utility in the same string isn't a gradient stop — ignored",
    );
});

// ---------------------------------------------------------------------------
// Auth CTA label: one spelling ("Sign in", sentence case) for every sign-in
// control, single source of truth = AUTH_CTA_LABEL (src/lib/auth/auth-gate-copy.ts).
// Reviewer round-1 fix-up (2026-09-17): two sites had drifted to "Log In".
// Shape-based, not a spelling list — classifies by what a literal LOOKS like
// (a bare control label vs. a route/identifier vs. real prose), so a new
// control anywhere in src is covered by construction, not by being added to
// a file list here.
// ---------------------------------------------------------------------------

const AUTH_CTA_FILE = path.join(ROOT, "src/lib/auth/auth-gate-copy.ts");

/** A control label that IS the sign-in action and nothing else — either verb,
 *  optional space/hyphen between the two words, case-insensitive. */
const BARE_AUTH_LABEL = /^\s*(?:sign|log)[ -]?in\s*$/i;

/** The "log in" spelling anywhere inside a longer string — the drift this
 *  fix-up reverses; "sign in" is the canonical verb and is never flagged. */
const LOG_IN_ANYWHERE = /\blog[ -]?in\b/i;

/** True when a literal's trimmed text is real user-facing copy rather than a
 *  route path, an identifier/discriminant value (AuthCardTab's "login", an
 *  event name, a CSS class), or other code plumbing. A route starts with
 *  "/"; an identifier/discriminant in this codebase is always a single
 *  lowercase token — no space, no capital letter. Real copy, even a
 *  lowercase control label, always has one or the other (a capital, sentence
 *  punctuation, or an internal space), so this classifies by shape, not by
 *  naming any file or literal. */
function isUserFacingAuthText(text: string): boolean {
    if (text.startsWith("/")) return false;
    if (!/[A-Z]/.test(text) && !/\s/.test(text)) return false;
    return true;
}

/** Every JSX text child and every whole string/template-literal value in a
 *  (comment-stripped) source file — the two shapes rendered copy can take. */
function extractTextAndLiterals(strippedSrc: string): string[] {
    const out: string[] = [];
    for (const m of strippedSrc.matchAll(/>([^<>{}]*)</g)) out.push(m[1]);
    for (const m of strippedSrc.matchAll(
        /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g,
    )) {
        out.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
    return out;
}

function isBareAuthLabelViolation(literal: string): boolean {
    const trimmed = literal.trim();
    return !!trimmed && isUserFacingAuthText(trimmed) && BARE_AUTH_LABEL.test(trimmed);
}

function isLogInSpellingViolation(literal: string): boolean {
    const trimmed = literal.trim();
    return !!trimmed && isUserFacingAuthText(trimmed) && LOG_IN_ANYWHERE.test(trimmed);
}

test("classifier self-test: bare-label + log-in-spelling detectors, on fixtures not among the sites this fix-up touched", () => {
    assert.ok(
        extractTextAndLiterals("<a>Log-in</a>").some(isBareAuthLabelViolation),
        'expected "<a>Log-in</a>" to be caught as a bare label',
    );
    assert.ok(
        extractTextAndLiterals('const x = "LOGIN";').some(isBareAuthLabelViolation),
        'expected "LOGIN" to be caught as a bare label',
    );
    assert.ok(
        extractTextAndLiterals("const msg = 'log in to continue';").some(isLogInSpellingViolation),
        "expected 'log in to continue' to be caught by the log-in-anywhere gate",
    );

    const routeLiterals = extractTextAndLiterals("router.push('/login');");
    assert.ok(
        routeLiterals.every((lit) => !isBareAuthLabelViolation(lit) && !isLogInSpellingViolation(lit)),
        "expected the '/login' route literal to pass both gates",
    );
    assert.ok(
        !isBareAuthLabelViolation("loginClient") && !isLogInSpellingViolation("loginClient"),
        "expected the loginClient identifier to pass both gates",
    );
    const proseLiterals = extractTextAndLiterals("<p>Sign in to save this search</p>");
    assert.ok(
        proseLiterals.every((lit) => !isBareAuthLabelViolation(lit) && !isLogInSpellingViolation(lit)),
        "expected sentence-case 'Sign in to save this search' prose to pass both gates",
    );
    // Edge case proven here, not at a fixed site: a bare lowercase AuthCardTab
    // discriminant ("login" — no space, no capital, e.g. `tab === "login"` or
    // the `"login" | "signup"` type) must pass both gates, or this test would
    // fail on every legitimate non-copy use of that value across the app.
    assert.ok(
        !isBareAuthLabelViolation("login") && !isLogInSpellingViolation("login"),
        'expected the bare "login" tab discriminant to pass both gates',
    );
});

test("no control renders a bare sign-in/log-in label outside AUTH_CTA_LABEL", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        if (file === AUTH_CTA_FILE) continue;
        const raw = readFileSync(file, "utf8");
        if (isFileAllowed(raw)) continue;
        const stripped = stripComments(raw);
        const rel = path.relative(ROOT, file);
        for (const literal of extractTextAndLiterals(stripped)) {
            if (isBareAuthLabelViolation(literal)) offenders.push(`${rel}: "${literal.trim()}"`);
        }
    }
    assert.deepEqual(
        [...new Set(offenders)],
        [],
        `bare sign-in/log-in label(s) found outside AUTH_CTA_LABEL: ${offenders.join("; ")}. Import ` +
            `AUTH_CTA_LABEL from @/lib/auth/auth-gate-copy and render {AUTH_CTA_LABEL} instead of a ` +
            `hard-coded label.`,
    );
});

test('no user-facing string in src spells the auth verb "log in" — canonical is "sign in"', () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        const raw = readFileSync(file, "utf8");
        if (isFileAllowed(raw)) continue;
        const stripped = stripComments(raw);
        const rel = path.relative(ROOT, file);
        for (const literal of extractTextAndLiterals(stripped)) {
            if (isLogInSpellingViolation(literal)) offenders.push(`${rel}: "${literal.trim()}"`);
        }
    }
    assert.deepEqual(
        [...new Set(offenders)],
        [],
        `"log in" spelling survives outside a route/identifier/event-name: ${offenders.join("; ")}. Canonical ` +
            `verb is "sign in" (sentence case) everywhere in user-facing copy.`,
    );
});

test("calm pass R4: backdrop-filter exists only in the one `material-bar` utility", () => {
    const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const full = path.join(dir, name);
            return statSync(full).isDirectory() ? walk(full) : /\.(css|tsx?|jsx?)$/.test(name) ? [full] : [];
        });
    const pattern = /backdrop-(?:filter|blur)/;
    const offenders = walk(path.join(ROOT, "src"))
        .filter((f) => f !== path.join(ROOT, "src/app/globals.css"))
        .filter((f) => pattern.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
        .map((f) => path.relative(ROOT, f));
    assert.deepEqual(offenders, [], `backdrop-filter/backdrop-blur outside globals.css: ${offenders.join(", ")}`);

    const css = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");
    const uses = [...css.matchAll(/backdrop-filter/g)].length;
    const util = css.match(/@utility material-bar\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(util, "@utility material-bar missing from globals.css");
    const inUtil = [...util.matchAll(/backdrop-filter/g)].length;
    // 2 sets + the @supports probe: every occurrence must live inside the utility.
    assert.equal(uses, inUtil, "backdrop-filter appears in globals.css outside @utility material-bar");
    assert.match(util, /@supports not \(backdrop-filter: blur\(1px\)\)/, "material-bar needs an opaque fallback");
});

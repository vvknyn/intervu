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
    assert.match(themeBlock, /--text-xs:\s*0\.8125rem;/, "@theme must override --text-xs to 0.8125rem (13px)");
    assert.match(themeBlock, /--text-sm:\s*0\.9375rem;/, "@theme must override --text-sm to 0.9375rem (15px)");
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
            /--primary-foreground:\s*255 255 255/,
            `${scope}: --primary-foreground must stay white on brand fills`,
        );
        assert.match(
            block,
            /--foreground:\s*(?!var\(--brand\))/,
            `${scope}: --foreground must remain body ink, not brand`,
        );
    }
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

/** True for a layer that is exactly the sanctioned overlay token. */
function isOverlayTokenShadowLayer(layer: string): boolean {
    return /^var\(--shadow-overlay\)$/.test(layer.trim());
}

/**
 * True if a single box-shadow layer (CSS `box-shadow:` syntax, e.g.
 * "0 10px 30px 0 rgba(10,10,10,0.07)") is a forbidden outer elevation shadow.
 */
function isForbiddenOuterShadowLayer(layer: string): boolean {
    return (
        !isInsetShadowLayer(layer) &&
        !isRingShadowLayer(layer) &&
        !isOverlayTokenShadowLayer(layer)
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

test("shadow means floating: .glass-panel/.glass-card never regain an outer shadow", () => {
    // Direct regression guard for the fix: these four blocks (base × hover,
    // light × dark) are the exact surfaces the owner's complaint named — every
    // job row cast a real drop shadow, and hover added more shadow plus a
    // lift. Only the inset sheen may remain.
    const blocks: Array<[string, RegExp]> = [
        ["light base", /^\.glass-panel,\n\.glass-card \{[\s\S]*?\n\}/m],
        ["dark base", /^\.dark \.glass-panel,\n\.dark \.glass-card \{[\s\S]*?\n\}/m],
        ["light hover", /^\.glass-card:hover \{[\s\S]*?\n\}/m],
        ["dark hover", /^\.dark \.glass-card:hover \{[\s\S]*?\n\}/m],
    ];

    for (const [label, pattern] of blocks) {
        const match = GLOBALS.match(pattern);
        assert.ok(match, `could not find the ${label} .glass-panel/.glass-card block`);
        const shadowMatch = match[0].match(/box-shadow\s*:\s*([^;]+);/);
        assert.ok(shadowMatch, `${label} block has no box-shadow declaration`);
        const offenders = splitShadowLayers(shadowMatch[1]).filter(isForbiddenOuterShadowLayer);
        assert.deepEqual(
            offenders,
            [],
            `${label} .glass-panel/.glass-card casts an outer shadow again: ${offenders.join(", ")}. ` +
                `In-flow surfaces are flat — separation is border + whitespace, hover is border-darkening.`,
        );
    }

    // The hover blocks must not lift either — a lift is the other half of
    // "floating," and the rule bans it from in-flow surfaces on its own.
    const hoverBlocks = GLOBALS.match(/\.glass-card:hover \{[\s\S]*?\n\}/g) ?? [];
    assert.ok(hoverBlocks.length >= 2, "expected a light and dark .glass-card:hover block");
    for (const block of hoverBlocks) {
        assert.doesNotMatch(
            block,
            /transform\s*:\s*translateY/,
            "a .glass-card:hover block still lifts on hover — hover affordance is border-darkening only",
        );
    }
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

    // Coverage half of the invariant: the primitives that are genuinely
    // floating (portal-rendered, nothing behind them) must actually carry the
    // token, not just fail to violate it — an explicit list of the surfaces
    // docs/design/ATTENTION.md names as overlays.
    const OVERLAY_PRIMITIVE_FILES = [
        "src/components/ui/dialog.tsx",
        "src/components/ui/sheet.tsx",
        "src/components/ui/tooltip.tsx",
        "src/components/ui/select.tsx",
        "src/components/ui/dropdown-menu.tsx",
        "src/components/ui/popover.tsx",
        "src/components/search/SearchAutocomplete.tsx",
    ];
    const missingToken = OVERLAY_PRIMITIVE_FILES.filter(
        (rel) => !readFileSync(path.join(ROOT, rel), "utf8").includes("shadow-[var(--shadow-overlay)]"),
    );
    assert.deepEqual(
        missingToken,
        [],
        `overlay primitive(s) missing the shadow-[var(--shadow-overlay)] treatment: ${missingToken.join(", ")}`,
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

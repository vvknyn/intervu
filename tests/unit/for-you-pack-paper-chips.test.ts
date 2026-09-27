import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
    DERIVED_CHIP_CLASS,
    POSTCARD_HEADER_DIVIDER,
    POSTCARD_ON_CREAM_BORDER,
    STATED_CHIP_CLASS,
} from "@/components/jobs/for-you/ForYouPack";
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from "../e2e/helpers/wcag-contrast";

const PACK_SRC = readFileSync(
    join(process.cwd(), "src/components/jobs/for-you/ForYouPack.tsx"),
    "utf8",
);
const GLOBALS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function lightThemeBlock(css: string): string {
    const open = css.indexOf("{", css.indexOf(":root"));
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error("unbalanced braces in :root");
}

function tokenRgb(block: string, token: string): [number, number, number] {
    const match = block.match(
        new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`),
    );
    assert.ok(match, `${token} must be an RGB triple in globals.css`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function mixRgb(
    fg: [number, number, number],
    bg: [number, number, number],
    alpha: number,
): [number, number, number] {
    return fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as [number, number, number];
}

function utilityBlock(css: string, className: string): string {
    const block = css.match(new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`, "s"))?.[1] ?? "";
    assert.ok(block.length > 0, `.${className} rule must exist in globals.css`);
    return block;
}

/** Parse `rgb(var(--token) / 0.15)` alpha from a utility declaration block. */
function parseRgbVarAlpha(declBlock: string, property: "border-color" | "background-color" | "color"): number | null {
    const prop = declBlock.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    const slash = prop.match(/rgb\(var\(--[a-z0-9-]+\)\s*\/\s*([0-9.]+)\)/i);
    if (slash) return Number(slash[1]);
    if (prop.match(/rgb\(var\(--[a-z0-9-]+\)\)/i)) return 1;
    return null;
}

function parseColorToken(declBlock: string, property: "border-color" | "background-color" | "color"): string {
    const prop = declBlock.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    const token = prop.match(/var\(--([a-z0-9-]+)\)/i)?.[1];
    assert.ok(token, `${property} must use a semantic CSS variable in ${declBlock}`);
    return `--${token}`;
}

describe("ForYouPack paper-context chips and header borders", () => {
    it("globals.css defines paper utilities with expected token alphas", () => {
        const creamBorder = utilityBlock(GLOBALS, "paper-on-cream-border");
        assert.equal(parseRgbVarAlpha(creamBorder, "border-color"), 0.15);
        assert.equal(parseColorToken(creamBorder, "border-color"), "--surface-postcard-foreground");

        const fact = utilityBlock(GLOBALS, "paper-fact-chip");
        assert.equal(parseRgbVarAlpha(fact, "border-color"), 0.15);
        assert.equal(parseRgbVarAlpha(fact, "background-color"), 0.05);
        assert.equal(parseColorToken(fact, "color"), "--surface-postcard-muted");

        const inferred = utilityBlock(GLOBALS, "paper-inferred-chip");
        assert.equal(parseRgbVarAlpha(inferred, "border-color"), 0.25);
        assert.equal(parseRgbVarAlpha(inferred, "background-color"), 0.1);
        assert.equal(parseColorToken(inferred, "color"), "--live-on-postcard");
        assert.notEqual(
            parseRgbVarAlpha(inferred, "background-color"),
            parseRgbVarAlpha(inferred, "color"),
            "inferred chip must not use the same alpha for fill and ink",
        );
    });

    it("ForYouPack constants use named paper utilities, not Tailwind colour/NN suffixes", () => {
        for (const label of ["STATED_CHIP_CLASS", "DERIVED_CHIP_CLASS", "POSTCARD_ON_CREAM_BORDER"] as const) {
            const block = PACK_SRC.match(
                new RegExp(`export const ${label}[\\s\\S]*?;`),
            )?.[0];
            assert.ok(block, `${label} export must exist`);
            assert.doesNotMatch(block, /\/(?:5|10|15|25)\b/, `${label} must not use Tailwind opacity suffixes`);
        }

        assert.match(STATED_CHIP_CLASS, /\bpaper-fact-chip\b/);
        assert.match(STATED_CHIP_CLASS, /font-medium/);
        assert.match(DERIVED_CHIP_CLASS, /\bpaper-inferred-chip\b/);
        assert.match(DERIVED_CHIP_CLASS, /font-normal/);
        assert.equal(POSTCARD_ON_CREAM_BORDER, "paper-on-cream-border");
        assert.match(POSTCARD_HEADER_DIVIDER, /\bpaper-on-cream-border\b/);

        for (const label of ["STATED_CHIP_CLASS", "DERIVED_CHIP_CLASS"] as const) {
            const block = PACK_SRC.match(
                new RegExp(`export const ${label} = cn\\([\\s\\S]*?\\);`),
            )?.[0];
            assert.ok(block, `${label} export must exist`);
            assert.doesNotMatch(block, /\bbg-background\b/, `${label} must not use canvas fill`);
            assert.doesNotMatch(block, /\btext-foreground\b/, `${label} must not use canvas ink`);
        }

        assert.match(DERIVED_CHIP_CLASS, /whitespace-normal/);
        assert.match(DERIVED_CHIP_CLASS, /break-words/);
    });

    it("stated and inferred chip text meets AA contrast on cream paper (alphas from CSS utilities)", () => {
        const fact = utilityBlock(GLOBALS, "paper-fact-chip");
        const inferred = utilityBlock(GLOBALS, "paper-inferred-chip");
        const statedBgAlpha = parseRgbVarAlpha(fact, "background-color");
        const derivedBgAlpha = parseRgbVarAlpha(inferred, "background-color");
        assert.equal(statedBgAlpha, 0.05);
        assert.equal(derivedBgAlpha, 0.1);

        const theme = lightThemeBlock(GLOBALS);
        const postcard = tokenRgb(theme, "--surface-postcard");
        const muted = tokenRgb(theme, "--surface-postcard-muted");
        const live = tokenRgb(theme, "--live-on-postcard");
        const ink = tokenRgb(theme, "--surface-postcard-foreground");

        const statedBg = mixRgb(ink, postcard, statedBgAlpha!);
        const statedRatio = contrastRatio(muted, statedBg);
        assert.ok(
            statedRatio >= WCAG_AA_NORMAL_TEXT,
            `stated chip muted on tint (${statedBgAlpha}): ${statedRatio.toFixed(2)}:1`,
        );

        const derivedBg = mixRgb(live, postcard, derivedBgAlpha!);
        const derivedRatio = contrastRatio(live, derivedBg);
        assert.ok(
            derivedRatio >= WCAG_AA_NORMAL_TEXT,
            `inferred chip live-on-postcard on tint (${derivedBgAlpha}): ${derivedRatio.toFixed(2)}:1`,
        );
    });
});

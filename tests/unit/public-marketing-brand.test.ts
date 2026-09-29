import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const BRAND_LEAK_RE = /\bintervu(?:\.cc|hq)?\b|\bintervuhq\b/i;

/** Public signed-out/marketing surfaces — not mock labs or internal-only routes. */
const PUBLIC_PAGE_DIRS = [
    "src/app/about",
    "src/app/pricing",
    "src/app/contact",
    "src/app/privacy",
    "src/app/terms",
    "src/app/connect",
    "src/app/trends",
    "src/app/stories",
    "src/app/research",
    "src/app/indeed-alternative",
    "src/app/linkedin-jobs-alternative",
    "src/app/eluta-alternative",
    "src/app/openclaw",
    "src/app/careers",
    "src/app/not-found.tsx",
    "src/app/error.tsx",
    "src/app/global-error.tsx",
];

const PUBLIC_LIB_FILES = [
    "src/lib/seo/constants.ts",
    "src/lib/seo/jsonld.ts",
    "src/lib/seo/alternatives.ts",
    "src/lib/faq.ts",
    "src/lib/marketing/public-copy.ts",
    "src/lib/marketing-stats.ts",
    "src/components/layout/Footer.tsx",
];

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function readPublic(path: string): string {
    return stripComments(readFileSync(join(ROOT, path), "utf8"));
}

describe("public marketing copy — Velai brand only", () => {
    it("core SEO + chrome exports do not leak intervu / intervuhq", () => {
        for (const rel of PUBLIC_LIB_FILES) {
            const src = readPublic(rel);
            assert.doesNotMatch(src, BRAND_LEAK_RE, rel);
        }
    });

    it("marketing app pages do not leak intervu / intervuhq (except connect/help installer marker)", () => {
        for (const rel of PUBLIC_PAGE_DIRS) {
            const abs = join(ROOT, rel);
            const paths: string[] = [];
            if (rel.endsWith(".tsx")) {
                paths.push(abs);
            } else {
                for (const entry of readdirSync(abs)) {
                    const full = join(abs, entry);
                    if (statSync(full).isFile() && entry.endsWith(".tsx")) paths.push(full);
                }
            }
            for (const file of paths) {
                const relPath = file.slice(ROOT.length + 1);
                let src = readPublic(relPath);
                // openclaw/install.sh writes this exact marker — not user-facing brand copy.
                if (relPath === "src/app/connect/help/page.tsx") {
                    src = src.replace(/# intervu installer[^\n]*/gi, "");
                    src = src.replace(/&ldquo;# intervu[^&]*&rdquo;/gi, "");
                }
                assert.doesNotMatch(src, BRAND_LEAK_RE, relPath);
            }
        }
    });

    it("transactional email shell renders VELAI wordmark, not intervu", () => {
        const palette = readFileSync(join(ROOT, "src/lib/email/templates/palette.ts"), "utf8");
        assert.match(palette, /text:\s*"Velai"/);
        assert.doesNotMatch(palette, /text:\s*"intervu"/i);
    });
});

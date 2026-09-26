import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGAL_LINKS } from "@/components/layout/Footer";
import { ELUTA_ALTERNATIVE, ELUTA_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { CAREER_HUBS } from "@/lib/seo/career-hubs";

const ROOT = join(__dirname, "../..");

const CANADA_RE = /canada|canadian|toronto|\bCAD\b/i;
/** Canada-specific boards / TLDs — not caught by CANADA_RE alone. */
const CANADA_GEO_MARKERS_RE = /Job Bank|Indeed\.ca/i;
const NUMERIC_FIT_RE = /\d+\s*%\s*match/i;

describe("reachable surfaces — no Canada marketing claims", () => {
    it("Footer.tsx has no Canada wording and no canada-jobs chrome link", () => {
        const src = readFileSync(join(ROOT, "src/components/layout/Footer.tsx"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
        assert.doesNotMatch(src, CANADA_GEO_MARKERS_RE);
        assert.doesNotMatch(src, /FOOTER_PROVENANCE_LINE/);
        assert.ok(!LEGAL_LINKS.some((link) => link.href.includes("canada-jobs")));
    });

    it("FrontDoorDetailPitch.tsx has no Canada wording or FOOTER_PROVENANCE_LINE", () => {
        const src = readFileSync(
            join(ROOT, "src/components/jobs/front-door/FrontDoorDetailPitch.tsx"),
            "utf8",
        );
        assert.doesNotMatch(src, CANADA_RE);
        assert.doesNotMatch(src, /FOOTER_PROVENANCE_LINE/);
    });

    it("seo/constants.ts has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/lib/seo/constants.ts"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("seo/jsonld.ts has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/lib/seo/jsonld.ts"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("faq.ts has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/lib/faq.ts"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("about/page.tsx has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/app/about/page.tsx"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("eluta-alternative page and ELUTA SEO copy have no Canada wording", () => {
        const page = readFileSync(join(ROOT, "src/app/eluta-alternative/page.tsx"), "utf8");
        const seoBundle = JSON.stringify({
            ...ELUTA_ALTERNATIVE,
            faq: ELUTA_ALTERNATIVE_FAQ,
        });
        const combined = `${page}\n${seoBundle}`;
        assert.doesNotMatch(combined, CANADA_RE);
        assert.doesNotMatch(combined, CANADA_GEO_MARKERS_RE);
    });

    it("seo/alternatives.ts has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/lib/seo/alternatives.ts"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("presentation/location.ts does not label all-Canada remote lists as Remote (Canada)", () => {
        const src = readFileSync(join(ROOT, "src/lib/presentation/location.ts"), "utf8");
        assert.doesNotMatch(src, /Remote \(Canada\)/);
    });

    it("career hub registry has no Canada marketing copy", () => {
        const bundle = JSON.stringify(CAREER_HUBS);
        assert.doesNotMatch(bundle, CANADA_RE);
        assert.doesNotMatch(bundle, CANADA_GEO_MARKERS_RE);
        assert.ok(!CAREER_HUBS.some((hub) => /canada|toronto|vancouver|montreal|calgary|ottawa/i.test(hub.slug)));
    });

    it("seo/constants.ts and faq.ts avoid numeric percent match claims", () => {
        for (const rel of ["src/lib/seo/constants.ts", "src/lib/faq.ts"] as const) {
            const src = readFileSync(join(ROOT, rel), "utf8");
            assert.doesNotMatch(src, NUMERIC_FIT_RE, rel);
        }
    });
});

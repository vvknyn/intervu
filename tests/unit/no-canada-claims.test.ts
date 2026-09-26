import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

const CANADA_RE = /canada|canadian|toronto|\bCAD\b/i;
const NUMERIC_FIT_RE = /\d+\s*%\s*match/i;

describe("reachable surfaces — no Canada marketing claims", () => {
    it("Footer.tsx has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/components/layout/Footer.tsx"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
        assert.doesNotMatch(src, /FOOTER_PROVENANCE_LINE/);
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

    it("eluta-alternative/page.tsx has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/app/eluta-alternative/page.tsx"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("seo/alternatives.ts has no Canada wording", () => {
        const src = readFileSync(join(ROOT, "src/lib/seo/alternatives.ts"), "utf8");
        assert.doesNotMatch(src, CANADA_RE);
    });

    it("presentation/location.ts does not label all-Canada remote lists as Remote (Canada)", () => {
        const src = readFileSync(join(ROOT, "src/lib/presentation/location.ts"), "utf8");
        assert.doesNotMatch(src, /Remote \(Canada\)/);
    });

    it("seo/constants.ts and faq.ts avoid numeric percent match claims", () => {
        for (const rel of ["src/lib/seo/constants.ts", "src/lib/faq.ts"] as const) {
            const src = readFileSync(join(ROOT, rel), "utf8");
            assert.doesNotMatch(src, NUMERIC_FIT_RE, rel);
        }
    });
});

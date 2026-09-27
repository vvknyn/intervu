import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";
import { CAREER_HUBS } from "@/lib/seo/career-hubs";
import {
    ELUTA_ALTERNATIVE,
    INDEED_ALTERNATIVE,
    LINKEDIN_JOBS_ALTERNATIVE,
} from "@/lib/seo/alternatives";

const ROOT = join(__dirname, "../..");
const NUMERIC_FIT_RE = /\d+\s*%\s*(match|fit|score)/i;
const FIT_BREAKDOWN_RE = /fit\s+breakdown/i;

const PUBLIC_MARKETING_FILES = [
    "src/lib/seo/constants.ts",
    "src/lib/faq.ts",
    "src/app/about/page.tsx",
    "src/app/connect/connect-client.tsx",
    "src/app/eluta-alternative/page.tsx",
    "src/app/indeed-alternative/page.tsx",
    "src/app/linkedin-jobs-alternative/page.tsx",
    "src/components/jobs/front-door/FrontDoorDetailPitch.tsx",
];

describe("public marketing — band-only fit copy", () => {
    it("PUBLIC_ANTI_SCORE_SENTENCE names Strong/Good/Stretch bands, not percentages", () => {
        assert.match(PUBLIC_ANTI_SCORE_SENTENCE, /Strong\/Good\/Stretch/);
        assert.doesNotMatch(PUBLIC_ANTI_SCORE_SENTENCE, NUMERIC_FIT_RE);
        assert.doesNotMatch(PUBLIC_ANTI_SCORE_SENTENCE, FIT_BREAKDOWN_RE);
    });

    it("marketing pages and SEO bundles avoid numeric fit and Fit breakdown claims", () => {
        const altBundle = JSON.stringify({
            INDEED_ALTERNATIVE,
            LINKEDIN_JOBS_ALTERNATIVE,
            ELUTA_ALTERNATIVE,
            careerHubs: CAREER_HUBS,
        });
        for (const rel of PUBLIC_MARKETING_FILES) {
            const src = readFileSync(join(ROOT, rel), "utf8");
            assert.doesNotMatch(src, NUMERIC_FIT_RE, rel);
            assert.doesNotMatch(src, FIT_BREAKDOWN_RE, rel);
        }
        assert.doesNotMatch(altBundle, NUMERIC_FIT_RE, "alternatives + career hubs");
        assert.doesNotMatch(altBundle, FIT_BREAKDOWN_RE, "alternatives + career hubs");
    });
});

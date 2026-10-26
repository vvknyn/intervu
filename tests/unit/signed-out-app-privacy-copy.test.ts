import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    RESUME_LOCAL_DEVICE_BANNER,
    RESUME_PAGE_SUBCOPY,
    RESUME_UPLOAD_PROMISE,
} from "@/lib/privacy-modes";

const ROOT = join(__dirname, "..", "..");

/** Signed-out or guest-first app surfaces (user-visible copy). */
const SIGNED_OUT_APP_COPY_FILES = [
    "src/app/resume/page.tsx",
    "src/lib/privacy-modes.ts",
    "src/lib/jobs/resume-cta-copy.ts",
    "src/lib/auth/auth-gate-copy.ts",
    "src/components/resume-builder/ResumeImportModal.tsx",
    "src/components/onboarding/SetupSteps.tsx",
    "src/components/jobs/LocalCustomizePanel.tsx",
    "src/components/settings/SettingsContainer.tsx",
    "src/app/connect/connect-client.tsx",
] as const;

const MISLEADING_ABSOLUTES: { pattern: RegExp; label: string }[] = [
    { pattern: /100%\s*On-Device/i, label: "100% On-Device" },
    { pattern: /100%\s*private guarantee/i, label: "100% private guarantee" },
    { pattern: /100%\s*on-device AI guarantee/i, label: "100% on-device AI guarantee" },
    { pattern: /100%\s*Private matching/i, label: "100% Private matching" },
    { pattern: /100%\s*on your device:/i, label: "100% on your device:" },
    { pattern: /Never stored in the cloud/i, label: "Never stored in the cloud" },
    { pattern: /never leaves your device/i, label: "never leaves your device" },
    { pattern: /Zero cloud tracking/i, label: "Zero cloud tracking" },
    { pattern: /work 100% in your browser without connecting/i, label: "100% in browser without MCP" },
    { pattern: /never on our servers/i, label: "never on our servers" },
];

/** Strip block/line comments only — string literals remain for copy scanning. */
function stripCommentsForScan(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function scanForMisleadingAbsolutes(src: string): string | null {
    const scanned = stripCommentsForScan(src);
    for (const { pattern, label } of MISLEADING_ABSOLUTES) {
        if (pattern.test(scanned)) return label;
    }
    return null;
}

describe("signed-out app surfaces — no misleading privacy absolutes", () => {
    it("CONTROL: scanner detects a banned claim in a synthetic user-visible string", () => {
        const hit = scanForMisleadingAbsolutes('const x = "100% On-Device AI";');
        assert.equal(hit, "100% On-Device");
        assert.equal(scanForMisleadingAbsolutes('// comment only 100% On-Device'), null);
    });

    it("corpus files (including privacy-modes.ts) avoid banned absolute privacy claims", () => {
        for (const rel of SIGNED_OUT_APP_COPY_FILES) {
            const raw = readFileSync(join(ROOT, rel), "utf8");
            const hit = scanForMisleadingAbsolutes(raw);
            assert.equal(hit, null, `${rel} still contains misleading claim: ${hit ?? "unknown"}`);
        }
    });

    it("/resume and shared copy align with /privacy on full file vs derived Meilisearch terms", () => {
        const privacy = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
        assert.match(privacy, /do not send your full résumé file or raw résumé[\s\S]*text to Meilisearch/i);
        assert.match(privacy, /search query derived[\s\S]*from your parsed résumé/i);

        assert.match(RESUME_LOCAL_DEVICE_BANNER, /The file is never uploaded/i);
        assert.match(RESUME_LOCAL_DEVICE_BANNER, /we send the search only: job titles or top skills/i);
        assert.match(RESUME_UPLOAD_PROMISE, /we send the search only/i);
        assert.doesNotMatch(RESUME_PAGE_SUBCOPY, /Strong, Good, and Stretch/i);
        assert.doesNotMatch(RESUME_PAGE_SUBCOPY, /\bFor you\b/i);

        const resumePage = readFileSync(join(ROOT, "src/app/resume/page.tsx"), "utf8");
        assert.ok(resumePage.includes("RESUME_LOCAL_DEVICE_BANNER_LABEL"));
        assert.ok(resumePage.includes("RESUME_PAGE_SUBCOPY"));
        assert.match(
            resumePage,
            /font-semibold text-foreground[\s\S]*RESUME_LOCAL_DEVICE_BANNER_LABEL/,
        );
    });
});

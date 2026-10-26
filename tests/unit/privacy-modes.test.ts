import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    PRIVACY_HEADLINE,
    PRIVACY_MODES,
    PRIVACY_RESUME_SECTION_ID,
    PRIVACY_SUMMARY,
} from "@/lib/privacy-modes";
import { POSTHOG_OPTIONS } from "@/lib/posthog-options";
import { shouldLogSearch } from "@/lib/jobs/search-log";
import { packFilters, packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import type { ResumeData } from "@/types/resume";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Velai describes its privacy as two modes (`PRIVACY_MODES`). Each point rests
 * on code; this file fails when that code stops doing what the point says, and
 * when a surface stops reading its copy from the one module.
 */

test("/privacy has the Your résumé section the other surfaces link to, and opens with both modes", () => {
    const privacy = read("src/app/privacy/page.tsx");
    assert.match(privacy, /<DocHeading id=\{PRIVACY_RESUME_SECTION_ID\}>Your résumé<\/DocHeading>/);
    assert.match(privacy, /<PrivacyModes /);
    assert.equal(PRIVACY_RESUME_SECTION_ID, "your-resume");
});

test("the two modes carry the spec copy", () => {
    assert.deepEqual(Object.keys(PRIVACY_MODES), ["local", "cloud"]);
    assert.equal(PRIVACY_MODES.local.name, "Local");
    assert.equal(PRIVACY_MODES.local.price, "Free");
    assert.equal(PRIVACY_MODES.cloud.name, "Private cloud");
    assert.equal(PRIVACY_MODES.local.points.length, 3);
    assert.equal(PRIVACY_MODES.cloud.points.length, 4);
    assert.equal(
        PRIVACY_MODES.local.points[0],
        "Your résumé is read in your browser and stays on this device. The file is never uploaded.",
    );
    assert.match(PRIVACY_MODES.cloud.points[1]!, /^AI tailoring runs on Tinfoil's sealed hardware\./);
    assert.match(PRIVACY_MODES.cloud.points[3]!, /^Deleted .+\. Never sold, never used to train AI\.$/);
});

test("every surface reads its privacy copy from the one module and declares none of its own", () => {
    const surfaces = [
        "src/app/privacy/page.tsx",
        "src/app/jobs/JobsContent.tsx",
        "src/app/pricing/pricing-client.tsx",
        "src/app/resume/page.tsx",
        "src/app/connect/connect-client.tsx",
        "src/app/llms.txt/route.ts",
        "src/components/legal/PrivacyModes.tsx",
        "src/components/settings/PlanCard.tsx",
        "src/components/settings/YourResumeSection.tsx",
        "src/components/resume-builder/ResumeImportModal.tsx",
        "src/components/jobs/LocalCustomizePanel.tsx",
        "src/components/company/company-page-copy.ts",
        "src/components/company/CompanyRoleSearch.tsx",
        "src/lib/jobs/resume-cta-copy.ts",
        "src/lib/faq.ts",
    ];
    for (const rel of surfaces) {
        assert.match(read(rel), /from "@\/(lib\/privacy-modes|components\/legal\/PrivacyModes)"/, `${rel} must import the privacy module`);
        assert.doesNotMatch(
            read(rel),
            /(stays on this device|read in your browser|AES-256|sealed hardware)[^\n]*\bexport const|export const [A-Z_]*(PRIVACY|PROMISE)[A-Z_]* = ["`]/,
            `${rel} declares its own privacy line`,
        );
    }
    assert.ok(existsSync(join(ROOT, "src/lib/privacy-modes.ts")));
    assert.ok(!existsSync(join(ROOT, "src/lib/legal/privacy-promises.ts")), "the old promises module is gone");
    assert.ok(!existsSync(join(ROOT, "src/lib/jobs/resume-privacy-copy.ts")), "the old résumé-copy module is gone");
});

test("the pricing page shows both modes side by side and no 'one plan' framing", () => {
    const pricing = read("src/app/pricing/pricing-client.tsx");
    assert.match(pricing, /data-testid="pricing-local-card"/);
    assert.match(pricing, /data-testid="pricing-card"/);
    assert.match(pricing, /md:grid-cols-2/);
    assert.doesNotMatch(pricing, /One plan/);
});

test("Local:  no route takes a résumé file, and parsing is in the browser", () => {
    assert.match(read("src/lib/local-ai/parse-resume.ts"), /withoutContactDetails/);
    const settingsUpload = read("src/components/settings/YourResumeSection.tsx");
    assert.match(settingsUpload, /extractResumeFileText/, "Settings reads the file in the browser and sends its text");
    assert.doesNotMatch(settingsUpload, /new FormData|formData\.append/i, "a file upload would break the promise");
});

test("Private cloud:  account records are sealed with AES-256-GCM", () => {
    assert.match(read("src/lib/db/docstore/seal.ts"), /createCipheriv\("aes-256-gcm"/);
});

test("Private cloud AI: contact details come out before the sealed read", () => {
    const parse = read("src/lib/local-ai/parse-resume.ts");
    assert.match(parse, /sealedChat\(\[\{ role: "user", content: readSealedPrompt\(withoutContactDetails\(/);
});

test("Local searches and analytics: no replays or autocapture, résumé searches unlogged", () => {
    assert.equal(POSTHOG_OPTIONS.disable_session_recording, true);
    assert.equal(POSTHOG_OPTIONS.autocapture, false);
    assert.equal(shouldLogSearch({ q: '"Registered Nurse"', fromResume: true }), false);

    const resume = {
        profile: { name: "Jordan Lee", profession: "Registered Nurse", location: "Toronto, Canada", yearsOfExperience: 5 },
        experience: [{ company: "Cedarbrook Health", role: "Registered Nurse", dates: "2021 - Present", description: "• Patient care" }],
        competencies: [{ category: "Clinical", skills: ["Triage", "Patient care"] }],
        education: [],
    } as unknown as ResumeData;
    const params = packSearchParams(packFilters(resume, resolveCandidateSignals(resume, null)));
    assert.equal(params.fromResume, true, "a pack's search is built from the résumé, so it must be marked unlogged");
});

test("the front door says both modes in the first screen and links the policy page", () => {
    const jobs = read("src/app/jobs/JobsContent.tsx");
    assert.match(jobs, /\{PRIVACY_HEADLINE\}/);
    assert.doesNotMatch(jobs, /<PrivacyModes /, "the modes are a policy-page block, not a front-door band");
    assert.equal(PRIVACY_HEADLINE, PRIVACY_SUMMARY);
    assert.match(PRIVACY_HEADLINE, /Free keeps your résumé on this device/);
    assert.match(PRIVACY_HEADLINE, /Paid saves it encrypted/);
});

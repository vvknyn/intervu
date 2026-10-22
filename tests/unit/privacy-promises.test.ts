import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_HEADLINE, PRIVACY_PROMISES, PRIVACY_RESUME_SECTION_ID } from "@/lib/legal/privacy-promises";
import { POSTHOG_OPTIONS } from "@/lib/posthog-options";
import { shouldLogSearch } from "@/lib/jobs/search-log";
import { packFilters, packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import type { ResumeData } from "@/types/resume";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The front door and /privacy make four promises about a résumé
 * (`PRIVACY_PROMISES`). Each one rests on code; this file fails when that
 * code stops doing what the promise says, so the claim can't outlive it.
 */

test("every promise links to a section /privacy has", () => {
    const privacy = read("src/app/privacy/page.tsx");
    assert.match(privacy, /<SectionTitle id=\{PRIVACY_RESUME_SECTION_ID\}>Your résumé<\/SectionTitle>/);
    for (const promise of PRIVACY_PROMISES) {
        const anchor = promise.href.split("#")[1];
        assert.ok(anchor, `${promise.id} links to a section`);
        const declared =
            anchor === PRIVACY_RESUME_SECTION_ID || new RegExp(`<SectionTitle id="${anchor}">`).test(privacy);
        assert.ok(declared, `/privacy has no section #${anchor} for "${promise.title}"`);
    }
});

test("read in your browser: no route takes a résumé file, and parsing is in the browser", () => {
    assert.match(read("src/lib/local-ai/parse-resume.ts"), /withoutContactDetails/);
    const settingsUpload = read("src/components/settings/YourResumeSection.tsx");
    assert.match(settingsUpload, /extractResumeFileText/, "Settings reads the file in the browser and sends its text");
    assert.doesNotMatch(settingsUpload, /new FormData|formData\.append/i, "a file upload would break the promise");
});

test("encrypted when saved: account records are sealed with AES-256-GCM", () => {
    assert.match(read("src/lib/db/docstore/seal.ts"), /createCipheriv\("aes-256-gcm"/);
});

test("AI sees only what it needs: contact details come out before the sealed read", () => {
    const parse = read("src/lib/local-ai/parse-resume.ts");
    assert.match(parse, /sealedChat\(\[\{ role: "user", content: readSealedPrompt\(withoutContactDetails\(/);
});

test("never sold or read by analytics: no words in replays or clicks, résumé searches unlogged", () => {
    assert.equal(POSTHOG_OPTIONS.session_recording?.maskTextSelector, "*");
    assert.equal(POSTHOG_OPTIONS.session_recording?.maskAllInputs, true);
    assert.equal(POSTHOG_OPTIONS.mask_all_text, true);
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

test("the front door says it in the first screen and links the promises on the policy page", () => {
    const jobs = read("src/app/jobs/JobsContent.tsx");
    assert.match(jobs, /\{PRIVACY_HEADLINE\}/);
    assert.doesNotMatch(jobs, /<PrivacyPromises /, "the promises are a policy-page block, not a front-door band");
    assert.match(PRIVACY_HEADLINE, /read in your browser and encrypted when saved/);
});

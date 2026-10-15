import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { APPLY_BUTTON_LABEL, APPLY_SIGNED_OUT_LABEL, applyButtonLabel } from "@/components/jobs/job-detail-facts";

/**
 * Defect [3] (launch-consistency sweep, 2026-09): the Apply button read three
 * different labels across three surfaces — a bare "Apply" on the desktop
 * split pane vs. "Apply on Company Site" on the standalone `/jobs/[slug]`
 * page and the mobile sheet. The fix is a single exported constant every
 * surface imports, so they cannot drift apart again. This is a source-scan
 * consistency guard (same `readFileSync` idiom as
 * tests/unit/company-render-guard.test.ts) rather than a full render — cheap
 * and it can't miss a re-introduced hardcoded literal.
 */

const JOB_DETAIL = readFileSync("src/components/jobs/JobDetail.tsx", "utf8");
const JOB_DETAIL_DOCUMENT = readFileSync("src/components/jobs/JobDetailDocument.tsx", "utf8");

describe("APPLY_BUTTON_LABEL — one shared source across every Apply surface", () => {
    it("is the honest wording: navigates to the employer's own posting, not an in-app flow", () => {
        assert.equal(APPLY_BUTTON_LABEL, "Apply on employer site");
    });

    // Focus group, 2026-10-12: signed-out people tapped "Apply on employer
    // site" and met a sign-in dialog. Confirmed signed out, the button says
    // what the tap does, in the dialog's own words.
    it("reads \"Sign in to apply\" only for a CONFIRMED signed-out session", () => {
        assert.equal(APPLY_SIGNED_OUT_LABEL, "Sign in to apply");
        assert.equal(applyButtonLabel(true), APPLY_SIGNED_OUT_LABEL);
        assert.equal(applyButtonLabel(false), APPLY_BUTTON_LABEL);
    });

    it("no file hardcodes the label literal — every surface must import the constant instead", () => {
        for (const [name, src] of [
            ["JobDetail.tsx", JOB_DETAIL],
            ["JobDetailDocument.tsx", JOB_DETAIL_DOCUMENT],
        ] as const) {
            assert.equal(
                src.includes('"Apply on Company Site"'),
                false,
                `${name} hardcodes the Apply label instead of importing APPLY_BUTTON_LABEL from job-detail-facts.ts`,
            );
        }
    });

    it("all three surfaces (mobile sticky bar, desktop split pane, standalone page) read the label through applyButtonLabel", () => {
        // JobDetail.tsx: JobDetailActionBar (mobile sticky bar, shared by the
        // mobile sheet + standalone page's mobile view), the desktop
        // split-pane button, and the "no description" prose sentence.
        const jobDetailUses = (JOB_DETAIL.match(/\{applyButtonLabel\(signedOut\)\}/g) ?? []).length;
        assert.equal(jobDetailUses, 3, "JobDetail.tsx should render applyButtonLabel(signedOut) from all 3 of its Apply-copy sites");

        // JobDetailDocument.tsx: the standalone page's own desktop Apply
        // button plus its "no description" prose sentence (+1 for the import).
        const documentUses = (JOB_DETAIL_DOCUMENT.match(/applyButtonLabel/g) ?? []).length;
        assert.equal(documentUses, 3, "JobDetailDocument.tsx should reference applyButtonLabel (import + its 2 Apply-copy sites)");
    });
});

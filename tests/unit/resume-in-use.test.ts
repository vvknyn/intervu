import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumeInUseLabel } from "@/components/jobs/ResumeInUse";

describe("resumeInUseLabel: the packs home names the résumé it ranks against", () => {
    it("names an uploaded file by its file name", () => {
        assert.equal(resumeInUseLabel("Vivek_Narayanan_TAM_Resume_V4.pdf"), "Vivek_Narayanan_TAM_Resume_V4.pdf");
        assert.equal(resumeInUseLabel(" cv.DOCX "), "cv.DOCX");
    });

    it("describes pasted text, an on-page edit and a résumé with no source in plain words", () => {
        assert.equal(resumeInUseLabel("Pasted text"), "the résumé you pasted");
        assert.equal(resumeInUseLabel("Adjusted parameters"), "your résumé");
        assert.equal(resumeInUseLabel("e2e-journey-synthetic"), "your résumé");
        assert.equal(resumeInUseLabel(null), "your résumé");
    });
});

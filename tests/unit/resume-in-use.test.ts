import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumeInUseLabel } from "@/components/jobs/ResumeInUse";

describe("resumeInUseLabel: the packs home names the résumé it ranks against", () => {
    it("names an uploaded file by its file name", () => {
        assert.equal(resumeInUseLabel({ sourceLabel: "Vivek_Narayanan_TAM_Resume_V4.pdf", signedIn: false }), "Vivek_Narayanan_TAM_Resume_V4.pdf");
        assert.equal(resumeInUseLabel({ sourceLabel: " cv.DOCX ", signedIn: true }), "cv.DOCX");
    });

    it("describes pasted text, an on-page edit and a résumé read back from the account in plain words", () => {
        assert.equal(resumeInUseLabel({ sourceLabel: "Pasted text", signedIn: false }), "the résumé you pasted");
        assert.equal(resumeInUseLabel({ sourceLabel: "Adjusted parameters", signedIn: false }), "your résumé");
        assert.equal(resumeInUseLabel({ sourceLabel: null, signedIn: true }), "your saved résumé");
        assert.equal(resumeInUseLabel({ sourceLabel: null, signedIn: false }), "your résumé");
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORM = join(__dirname, "..", "..", "src", "components", "auth", "ResetPasswordForm.tsx");

describe("ResetPasswordForm", () => {
    it("uses h1 for Set new password", () => {
        const src = readFileSync(FORM, "utf8");
        assert.match(src, /<h1[^>]*>\s*Set new password/);
        assert.doesNotMatch(src, /<h2[^>]*>\s*Set new password/);
    });

    it("disables password fields and submit without a reset token", () => {
        const src = readFileSync(FORM, "utf8");
        assert.match(src, /!oobCode/);
        assert.match(src, /disabled=\{isPending \|\| !oobCode\}/);
        assert.match(src, /\{oobCode && \(/);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORM = join(__dirname, "..", "..", "src", "components", "auth", "ResetPasswordForm.tsx");

describe("ResetPasswordForm", () => {
    it("uses h1 for Set new password", () => {
        const src = readFileSync(FORM, "utf8");
        assert.match(src, /<(h1|PageTitle)\b[^>]*>\s*Set new password/); // PageTitle renders the h1
        assert.doesNotMatch(src, /<h2[^>]*>\s*Set new password/);
    });

    it("disables password fields and submit without a reset token", () => {
        // WorkOS's reset link carries `?token=...` (see the component's own
        // doc comment) — Firebase's `oobCode` no longer exists here.
        const src = readFileSync(FORM, "utf8");
        assert.match(src, /!token/);
        assert.match(src, /disabled=\{isPending \|\| !token\}/);
        assert.match(src, /\{token && \(/);
    });
});

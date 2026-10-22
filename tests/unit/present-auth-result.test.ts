import { test } from "node:test";
import assert from "node:assert/strict";
import { presentAuthResult } from "../../src/components/auth/present-auth-result";

const typed = { username: "dave" };

test("an error stays inline so the person can correct the form", () => {
    assert.deepEqual(presentAuthResult({ error: "Username is already taken" }, typed), { inline: "Username is already taken" });
});

test("a success notice is a success toast that opens login with the typed username", () => {
    assert.deepEqual(
        presentAuthResult({ notice: "Account created — sign in to continue.", kind: "success" }, typed),
        { toast: { kind: "success", text: "Account created — sign in to continue." }, switchTab: "login", prefill: { username: "dave" } },
    );
});

test("an info notice is an info toast", () => {
    const presented = presentAuthResult({ notice: "Check your inbox", kind: "info" }, typed);
    assert.deepEqual("toast" in presented && presented.toast, { kind: "info", text: "Check your inbox" });
});

test("success is ok", () => {
    assert.deepEqual(presentAuthResult({ success: true }, typed), { ok: true });
});

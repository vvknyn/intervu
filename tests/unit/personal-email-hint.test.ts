import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PERSONAL_EMAIL_HINT } from "../../src/lib/auth/auth-gate-copy";
import { SearchAlertCapture } from "../../src/components/jobs/SearchAlertCapture";
import { LoginForm } from "../../src/components/auth/login-form";

const SRC = join(__dirname, "../../src");

/** An email input in any JSX spelling: type="email", type='email', type={"email"}, type={'email'}, type={`email`}. */
const EMAIL_INPUT = /type=(?:["']email["']|\{\s*["'`]email["'`]\s*\})/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

/** Email inputs whose submit cannot create an account: they must NOT be forced to show the hint. */
const NON_ACCOUNT_EMAIL_INPUTS = [
  "app/pricing/founding-reserve-form.tsx", // reserves a seat, no account
  "components/contact/ContactForm.tsx",
  "components/auth/ForgotPasswordForm.tsx", // existing account
  "components/resume-builder/EditingPanel.tsx", // résumé contact field, never submitted
  "components/marketing/OpenclawWaitlistForm.tsx",
];

describe("personal-email hint on account-creation doors", () => {
  it("wording is pinned", () => {
    assert.equal(PERSONAL_EMAIL_HINT, "Use a personal email, not your work one.");
  });

  it("every component with an email input renders the hint at least once per input, unless it is a known non-account form", () => {
    const emailInputs = (text: string) => (text.match(EMAIL_INPUT) ?? []).length;
    const hintRenders = (text: string) =>
      text.split("\n").filter((line) => line.includes("PERSONAL_EMAIL_HINT") && !/^\s*import\b/.test(line)).length;
    const missing = sourceFiles(SRC)
      .map((f) => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }))
      .filter(({ file, text }) => emailInputs(text) > 0 && !NON_ACCOUNT_EMAIL_INPUTS.includes(file))
      .filter(({ text }) => hintRenders(text) < emailInputs(text))
      .map(({ file }) => file);
    assert.deepEqual(missing, [], "email door with fewer PERSONAL_EMAIL_HINT renders than email inputs (add it, or list it as non-account)");
  });

  it("the input matcher catches every spelling of type email", () => {
    for (const form of [`type="email"`, `type='email'`, `type={"email"}`, `type={'email'}`, "type={`email`}"]) {
      assert.equal((form.match(EMAIL_INPUT) ?? []).length, 1, form);
    }
    assert.equal((`type="text"`.match(EMAIL_INPUT) ?? []).length, 0);
  });

  it("SearchAlertCapture renders the hint in both layouts", () => {
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(SearchAlertCapture, { compact } as never));
      assert.ok(html.includes(PERSONAL_EMAIL_HINT), `compact=${compact}`);
      assert.ok(!html.includes("you@company.com"));
    }
  });

  it("login form renders the hint on the signup tab only", () => {
    const render = (defaultTab: "login" | "signup") =>
      renderToStaticMarkup(
        React.createElement(AppRouterContext.Provider, { value: {} as never }, React.createElement(LoginForm, { defaultTab } as never)),
      );
    const signup = render("signup");
    const login = render("login");
    assert.ok(signup.includes(PERSONAL_EMAIL_HINT));
    assert.ok(!login.includes(PERSONAL_EMAIL_HINT));
  });
});

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

/** An `<input>`/`<Input>` element, up to its closing `/>`. */
const INPUT_ELEMENT = /<\w*[Ii]nput\b[\s\S]*?\/>/g;
/**
 * An element that can take an email: type="email", inputMode="email" or autoComplete="email", or
 * type={expr} where expr names "email" or has no string literal at all (a variable we cannot read).
 * `type={show ? "text" : "password"}` is not one.
 */
const EMAIL_SIGNAL =
  /(?:type|inputMode|autoComplete)=(?:["']email["']|\{[^}]*["'`]email["'`][^}]*\})|type=\{[^}"'`]*\}/;
const emailInputCount = (text: string) => (text.match(INPUT_ELEMENT) ?? []).filter((el) => EMAIL_SIGNAL.test(el)).length;

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
  "components/ui/input.tsx", // generic <input> wrapper: the caller picks the type
  "components/jobs/SerpFilters.tsx", // type={inputType}: checkbox/radio filter rows
];

describe("personal-email hint on account-creation doors", () => {
  it("wording is pinned", () => {
    assert.equal(PERSONAL_EMAIL_HINT, "Use a personal email, not your work one.");
  });

  it("every component with an email input renders the hint at least once per input, unless it is a known non-account form", () => {
    const hintRenders = (text: string) =>
      text.split("\n").filter((line) => line.includes("PERSONAL_EMAIL_HINT") && !/^\s*import\b/.test(line)).length;
    const missing = sourceFiles(SRC)
      .map((f) => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }))
      .filter(({ file, text }) => emailInputCount(text) > 0 && !NON_ACCOUNT_EMAIL_INPUTS.includes(file))
      .filter(({ text }) => hintRenders(text) < emailInputCount(text))
      .map(({ file }) => file);
    assert.deepEqual(missing, [], "email door with fewer PERSONAL_EMAIL_HINT renders than email inputs (add it, or list it as non-account)");
  });

  it("the input matcher catches every spelling of an email input, and counts an element once", () => {
    for (const attr of [`type="email"`, `type='email'`, `type={"email"}`, "type={`email`}", `inputMode="email"`, `autoComplete="email"`, `type={kind}`, `type={cond ? "email" : "text"}`]) {
      assert.equal(emailInputCount(`<input ${attr} />`), 1, attr);
    }
    assert.equal(emailInputCount(`<Input\n type="email"\n autoComplete="email"\n inputMode="email" />`), 1);
    for (const attr of [`type="text"`, `type={show ? "text" : "password"}`, `autoComplete="one-time-code"`]) {
      assert.equal(emailInputCount(`<input ${attr} />`), 0, attr);
    }
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

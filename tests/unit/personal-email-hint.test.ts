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
  "components/account/AccountEmailPrompt.tsx", // existing account
];

describe("personal-email hint on account-creation doors", () => {
  it("wording is pinned", () => {
    assert.equal(PERSONAL_EMAIL_HINT, "Use a personal email, not your work one.");
  });

  it("every component with an email input shows the hint unless it is a known non-account form", () => {
    const missing = sourceFiles(SRC)
      .filter((f) => /type=["']email["']/.test(readFileSync(f, "utf8")))
      .filter((f) => !readFileSync(f, "utf8").includes("PERSONAL_EMAIL_HINT"))
      .map((f) => f.slice(SRC.length + 1))
      .filter((f) => !NON_ACCOUNT_EMAIL_INPUTS.includes(f));
    assert.deepEqual(missing, [], "email door without PERSONAL_EMAIL_HINT (add it, or list it as non-account)");
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";
import { renderEmailShellHtml, renderEmailShellText } from "@/lib/email/templates/base";

const ROOT = join(__dirname, "..", "..");

/** Public legal copy + routed contact + product email shell — not marketing blast templates. */
const LEGAL_AND_EMAIL_SURFACES = [
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/contact/page.tsx",
  "src/lib/email/templates/base.ts",
  "src/lib/legal/public-contact.ts",
] as const;

/** Must use `PUBLIC_SUPPORT_EMAIL` — no literal drift on these paths. */
const PUBLIC_CONTACT_SURFACES = [
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/contact/page.tsx",
  "src/components/contact/ContactForm.tsx",
  "src/lib/contact/submit.ts",
  "src/lib/email/templates/base.ts",
] as const;

const ENTITY_OR_ADDRESS_PLACEHOLDERS: RegExp[] = [
  /\[.*(?:address|entity).*]/i,
  /123 Main/i,
  /TBD\s+(?:address|entity)/i,
  /registered office/i,
];

/** Example / user-input placeholders on forms — not public support addresses. */
const ALLOWED_INCIDENTAL_EMAIL = /^(you@company\.com|.+@example\.(com|org|test))$/i;

const PUBLIC_SUPPORT_DRIFT_LITERALS: RegExp[] = [
  /hello@thesubspace\.io/i,
  /support@velai\.app/i,
  /hello@velai\.app/i,
  /privacy@velai\.app/i,
];

/** Positive export promises only — privacy/terms may negate these explicitly. */
const ACCOUNT_DATA_EXPORT_PROMISES: RegExp[] = [
  /(?:we )?(?:offer|provide|will send you).{0,40}export.{0,40}(?:account|your data)/i,
  /download a copy of your account/i,
];

const GOVERNING_LAW: RegExp[] = [/governing law/i, /jurisdiction of/i, /exclusive venue/i];

const HARDCODED_POSTAL_IN_SHELL: RegExp[] = [
  /\d{1,5}\s+\w+\s+(St|Street|Ave|Avenue|Rd|Road)\b/i,
  /Suite\s+\d+/i,
];

function articleProse(pagePath: string): string {
  const src = readFileSync(join(ROOT, pagePath), "utf8");
  const article = src.split("<Prose")[1]?.split("</Prose>")[0] ?? src;
  return article.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function scanForPublicSupportDrift(src: string, rel: string): void {
  if (rel === "src/lib/legal/public-contact.ts") return;
  for (const re of PUBLIC_SUPPORT_DRIFT_LITERALS) {
    assert.doesNotMatch(src, re, `${rel} hardcodes a public support email — use PUBLIC_SUPPORT_EMAIL`);
  }
  assert.match(src, /PUBLIC_SUPPORT_EMAIL/, `${rel} must import/use PUBLIC_SUPPORT_EMAIL`);
}

describe("public legal & email contact copy guards", () => {
  it("PUBLIC_SUPPORT_EMAIL is hello@thesubspace.io", () => {
    assert.equal(PUBLIC_SUPPORT_EMAIL, "hello@thesubspace.io");
  });

  it("public contact surfaces use the shared constant (no support-email literal drift)", () => {
    for (const rel of PUBLIC_CONTACT_SURFACES) {
      scanForPublicSupportDrift(readFileSync(join(ROOT, rel), "utf8"), rel);
    }
  });

  it("ContactForm may keep incidental example placeholders, not alternate support addresses", () => {
    const src = readFileSync(join(ROOT, "src/components/contact/ContactForm.tsx"), "utf8");
    const emails = src.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
    for (const email of emails) {
      if (email === PUBLIC_SUPPORT_EMAIL) {
        assert.fail("ContactForm must reference PUBLIC_SUPPORT_EMAIL, not a literal");
      }
      if (ALLOWED_INCIDENTAL_EMAIL.test(email)) continue;
      assert.fail(`unexpected email literal in ContactForm: ${email}`);
    }
  });

  it("privacy/terms/contact/email shell have no entity or postal placeholders", () => {
    for (const rel of LEGAL_AND_EMAIL_SURFACES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const re of ENTITY_OR_ADDRESS_PLACEHOLDERS) {
        assert.doesNotMatch(src, re, `${rel} matches placeholder ${re}`);
      }
    }
  });

  it("privacy and terms do not promise account-data export/download", () => {
    for (const rel of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"] as const) {
      const prose = articleProse(rel);
      for (const re of ACCOUNT_DATA_EXPORT_PROMISES) {
        assert.doesNotMatch(prose, re, `${rel} implies account export: ${re}`);
      }
      assert.match(prose, /do not (?:offer|provide).*bulk export|do not provide a separate bulk download/i);
    }
  });

  it("privacy and terms omit governing-law / jurisdiction clauses", () => {
    for (const rel of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"] as const) {
      const prose = articleProse(rel);
      for (const re of GOVERNING_LAW) {
        assert.doesNotMatch(prose, re, `${rel} contains governing law copy: ${re}`);
      }
    }
  });

  it("privacy discloses self-serve deletion flow, scope, and PostHog exclusion", () => {
    const pageSrc = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
    const prose = articleProse("src/app/privacy/page.tsx");
    assert.match(pageSrc, /ACCOUNT_SELF_SERVE_DELETION_FLOW/);
    assert.match(ACCOUNT_SELF_SERVE_DELETION_FLOW, /type DELETE/i);
    assert.match(ACCOUNT_SELF_SERVE_DELETION_FLOW, /danger zone/i);
    assert.match(prose, /local storage[\s\S]{0,24}first/i);
    assert.match(prose, /sign you out/i);
    assert.match(prose, /WorkOS/i);
    assert.match(prose, /no call to PostHog to delete/i);
    assert.match(prose, /does not remove analytics[\s\S]{0,40}replay-derived/i);
    assert.match(prose, /replay recordings[\s\S]{0,80}30 days/i);
    assert.match(prose, /not confirmed a fixed[\s\S]{0,120}analytics events or heatmap/i);
    assert.doesNotMatch(prose, /follow the PostHog retention described above/i);
    assert.match(prose, /contact-form|connect-waitlist/i);
  });

  it("rendered email shell includes support email and no hardcoded postal address line", () => {
    const html = renderEmailShellHtml({
      siteUrl: "https://example.test",
      unsubscribeUrl: "https://example.test/unsubscribe?t=x",
      preheader: "test",
      heading: "Test",
      bodyHtml: "<p>body</p>",
    });
    const text = renderEmailShellText({
      siteUrl: "https://example.test",
      unsubscribeUrl: "https://example.test/unsubscribe?t=x",
      preheader: "test",
      heading: "Test",
      bodyText: "body",
    });
    assert.match(html, new RegExp(PUBLIC_SUPPORT_EMAIL));
    assert.match(text, new RegExp(PUBLIC_SUPPORT_EMAIL));
    for (const re of HARDCODED_POSTAL_IN_SHELL) {
      assert.doesNotMatch(html, re, "email shell HTML must not invent a postal address");
      assert.doesNotMatch(text, re, "email shell text must not invent a postal address");
    }
  });

  it("product email shell render path does not read postal env vars", () => {
    const base = readFileSync(join(ROOT, "src/lib/email/templates/base.ts"), "utf8");
    assert.doesNotMatch(base, /process\.env\.(?:EMAIL_POSTAL|MARKETING_SENDER_POSTAL)/);
  });
});

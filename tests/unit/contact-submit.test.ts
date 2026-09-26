import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveContactGate,
  submitContact,
  notifyContactSubmission,
  normalizeContactKind,
  buildContactNotificationEmail,
} from "../../src/lib/contact/submit";
import { validate, contactMessageSchema } from "../../src/lib/validation";

const VALID_INPUT = {
  email: "ada@example.com",
  message: "I have a question about a listing.",
  honeypot: "",
  path: "/contact",
};

describe("resolveContactGate", () => {
  it("rejects on a Turnstile reject, without looking at validation", () => {
    const result = resolveContactGate({
      turnstile: { status: "reject", reason: "invalid-token" },
      validated: validate(contactMessageSchema, { email: VALID_INPUT.email, message: VALID_INPUT.message }),
    });
    assert.deepEqual(result, {
      proceed: false,
      result: { error: "Verification failed — please try again.", status: 400 },
    });
  });

  it("rejects on invalid input when Turnstile passes", () => {
    const result = resolveContactGate({
      turnstile: { status: "pass" },
      validated: validate(contactMessageSchema, { email: "not-an-email", message: "hi" }),
    });
    assert.equal(result.proceed, false);
    assert.ok(!result.proceed && "error" in result.result);
    assert.equal(result.result.status, 400);
  });

  it("proceeds with the validated data when Turnstile passes (or is not configured) and input is valid", () => {
    for (const turnstile of [{ status: "pass" as const }, { status: "not-configured" as const }]) {
      const validated = validate(contactMessageSchema, { email: VALID_INPUT.email, message: VALID_INPUT.message });
      const result = resolveContactGate({ turnstile, validated });
      assert.equal(result.proceed, true);
      assert.ok(result.proceed && result.data.email === VALID_INPUT.email);
    }
  });
});

describe("submitContact — honeypot drop", () => {
  it("returns success without touching Turnstile or Firestore when the honeypot is filled", async () => {
    // No TURNSTILE_SECRET_KEY/FIREBASE_SERVICE_ACCOUNT_KEY in a `tsx --test`
    // run — if this path reached either, it would hang or throw. Resolving
    // to success proves the honeypot short-circuit fires first.
    const result = await submitContact({ ...VALID_INPUT, honeypot: "http://spam.example" });
    assert.deepEqual(result, { success: true });
  });

  // Class guard, not the incident instance: a second honeypot value proves
  // the drop is keyed on "was it filled at all", not one specific string.
  it("also drops a differently-shaped honeypot value", async () => {
    const result = await submitContact({ ...VALID_INPUT, honeypot: "sure, I'm a bot" });
    assert.deepEqual(result, { success: true });
  });
});

describe("submitContact — Turnstile reject", () => {
  it("surfaces the verification-failed error without a token, once a secret key is configured", async () => {
    const original = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    try {
      const result = await submitContact({ ...VALID_INPUT, turnstileToken: undefined });
      assert.deepEqual(result, { error: "Verification failed — please try again.", status: 400 });
    } finally {
      if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = original;
    }
  });
});

describe("normalizeContactKind — kind coercion + context truncation", () => {
  it("keeps kind 'bug' as-is and passes its context through", () => {
    const result = normalizeContactKind("bug", { page: "/jobs", userAgent: "ua", viewport: "1440x900" });
    assert.equal(result.kind, "bug");
    assert.deepEqual(result.context, { page: "/jobs", userAgent: "ua", viewport: "1440x900" });
  });

  it("coerces a bogus kind value to 'message' and drops any context", () => {
    const result = normalizeContactKind("something-else", { page: "/jobs", userAgent: "ua" });
    assert.equal(result.kind, "message");
    assert.equal(result.context, undefined);
  });

  it("drops context when kind is 'message', even if context was supplied", () => {
    const result = normalizeContactKind("message", { page: "/jobs" });
    assert.equal(result.kind, "message");
    assert.equal(result.context, undefined);
  });

  it("truncates every context field to 300 chars when kind is 'bug'", () => {
    const result = normalizeContactKind("bug", {
      page: "p".repeat(400),
      userAgent: "a".repeat(400),
      viewport: "v".repeat(400),
    });
    assert.equal(result.kind, "bug");
    assert.equal(result.context?.page?.length, 300);
    assert.equal(result.context?.userAgent?.length, 300);
    assert.equal(result.context?.viewport?.length, 300);
  });
});

describe("buildContactNotificationEmail — subject prefix and debug block by kind", () => {
  it("uses the [Velai Bug] subject prefix when kind is 'bug'", () => {
    const { subject, text } = buildContactNotificationEmail(
      { email: VALID_INPUT.email, message: VALID_INPUT.message },
      VALID_INPUT.path,
      "bug",
      { page: "/jobs", userAgent: "ua" },
    );
    assert.match(subject, /^\[Velai Bug\]/);
    assert.match(text, /Debug info:/);
    assert.match(text, /page: \/jobs/);
  });

  it("uses the [Velai Contact] subject prefix when kind is 'message', with no debug block", () => {
    const { subject, text } = buildContactNotificationEmail(
      { email: VALID_INPUT.email, message: VALID_INPUT.message },
      VALID_INPUT.path,
      "message",
    );
    assert.match(subject, /^\[Velai Contact\]/);
    assert.doesNotMatch(text, /Debug info:/);
  });
});

describe("notifyContactSubmission — email failure never throws, and logs (Fix 1's core rule)", () => {
  it("resolves without throwing and logs the failure reason when RESEND_API_KEY is unset", async () => {
    // House pattern (see verify-follow-email.test.ts): `tsx --test` never
    // loads `.env.local`, so RESEND_API_KEY is genuinely unset — sendEmail
    // resolves {sent:false, reason:"no-api-key"} rather than throwing. This
    // is the exact property the incident violated: a lost notification
    // must be logged, and must never fail the submission that already
    // persisted in Firestore.
    const calls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      await assert.doesNotReject(() => notifyContactSubmission({ email: VALID_INPUT.email, message: VALID_INPUT.message }, VALID_INPUT.path));
    } finally {
      console.error = originalError;
    }
    assert.equal(calls.length, 1);
    assert.match(String(calls[0][0]), /\[Contact\] notification email failed:/);
    assert.equal(calls[0][1], "no-api-key");
  });

  // Class guard: a second, differently-shaped submission (with a name)
  // proves this isn't keyed to one particular payload shape.
  it("also logs (not throws) for a submission that includes a name", async () => {
    const calls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      await assert.doesNotReject(() =>
        notifyContactSubmission({ name: "Ada", email: "ada@example.com", message: "Another message." }, "/co/acme"),
      );
    } finally {
      console.error = originalError;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "no-api-key");
  });
});

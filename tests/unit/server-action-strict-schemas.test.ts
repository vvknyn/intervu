import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  createApplicationSchema,
  addFavoriteSchema,
  saveSourceSchema,
  updateAppConfigSchema,
} from "@/lib/validation";
import { accountResumeText } from "@/lib/pursuits/applied-resume";

/**
 * A server action that writes client-supplied keys into Firestore validates
 * them against a strict schema first: unknown keys are refused, never copied.
 * Résumé text (`applied_resume`, `resume_versions`) is server-set only.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";

const validCreate = { company_name: "Acme", position: "Engineer", status: "interested" };

describe("createApplicationSchema (createApplication)", () => {
  for (const [name, extra] of [
    ["applied_resume", { applied_resume: { saved_at: "2026-10-01", content: "my résumé" } }],
    ["resume_versions", { resume_versions: [{ content: "my résumé", label: "v1", saved_at: "2026-10-01" }] }],
    ["user_id", { user_id: "someone-else" }],
    ["created_at", { created_at: "1999-01-01" }],
    ["an arbitrary key", { is_admin: true }],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.ok(validate(createApplicationSchema, { ...validCreate, ...extra }).error);
    });
  }

  it("accepts the legal create fields and drops cleared optionals", () => {
    const r = validate(createApplicationSchema, { ...validCreate, job_url: "", note: " hi " });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.note, "hi");
    assert.equal(r.data?.job_url, undefined);
  });

  it("requires company, role and a known status", () => {
    assert.ok(validate(createApplicationSchema, { ...validCreate, company_name: "" }).error);
    assert.ok(validate(createApplicationSchema, { ...validCreate, status: "ghosted" }).error);
  });
});

describe("the other actions that spread client input into a doc", () => {
  it("addFavorite refuses user_id and unknown keys, accepts a question", () => {
    assert.ok(validate(addFavoriteSchema, { question_text: "Why us?", user_id: "x" }).error);
    assert.ok(validate(addFavoriteSchema, { question_text: "Why us?", extra: 1 }).error);
    assert.equal(validate(addFavoriteSchema, { question_text: "Why us?", notes: "n" }).error, undefined);
  });

  it("saveSource refuses user_id, id, created_at and unknown keys, accepts a source", () => {
    const ok = { type: "text", title: "Notes", content: "body" };
    for (const extra of [{ user_id: "x" }, { id: "x" }, { created_at: "x" }, { extra: 1 }]) {
      assert.ok(validate(saveSourceSchema, { ...ok, ...extra }).error);
    }
    assert.equal(validate(saveSourceSchema, { ...ok, visibility: "public" }).error, undefined);
    assert.ok(validate(saveSourceSchema, { ...ok, visibility: "everyone" }).error);
  });

  it("updateAppConfig refuses unknown keys, and an empty URL still clears the link", () => {
    assert.ok(validate(updateAppConfigSchema, { show_donation: true, role: "admin" }).error);
    assert.equal(validate(updateAppConfigSchema, { donation_url: "" }).data?.donation_url, "");
  });
});

describe("accountResumeText (the résumé a role keeps when marked Applied)", () => {
  async function withErrorSpy<T>(run: () => Promise<T>): Promise<{ out: T; errors: number }> {
    const original = console.error;
    let errors = 0;
    console.error = () => { errors += 1; };
    try {
      return { out: await run(), errors };
    } finally {
      console.error = original;
    }
  }

  it("is null for an unpaid account, and the stored résumé is never read", async () => {
    const { out, errors } = await withErrorSpy(() => accountResumeText("u-unpaid", async () => false));
    assert.equal(out, null);
    assert.equal(errors, 0, "no read was attempted");
  });

  it("control: a paid account does reach the read", async () => {
    const { errors } = await withErrorSpy(() => accountResumeText("u-paid", async () => true));
    assert.equal(errors, 1, "the read ran (and failed here: no Firestore in unit tests)");
  });
});

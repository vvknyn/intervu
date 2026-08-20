import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import type { FollowAlertGroup } from "../../src/lib/follows/alerts";
import { sendEmailFollowDigests, type SendEmailFollowDigestsDeps } from "../../src/lib/email/digest/pg-lane";

// `sendEmailFollowDigests` calls `getSiteUrl()` internally (for the
// seeAllHref/unsubscribeUrl origin) — same env seam `seo-constants.test.ts`
// documents: no module-scope caching, so setting it once here is observed
// by every call in this file.
const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
before(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
});
after(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

// The store/search/send seams below are the same fakes `submit-follow.test.ts`
// and `verify-follow-consume.test.ts` use — a scripted Queryable, and plain
// injected functions for the two real I/O calls (`listNewRolesForFollows`,
// `sendEmail`) this module makes per recipient.
class FakeQueryable implements Queryable {
  async query<R = Record<string, unknown>>(): Promise<{ rows: R[] }> {
    throw new Error("FakeQueryable: not used directly — listRecipients is injected");
  }
}

function recipient(overrides: Partial<Parameters<typeof baseRecipient>[0]> = {}) {
  return baseRecipient(overrides);
}
function baseRecipient(overrides: {
  identityId?: string;
  email?: string;
  follows?: Array<{ domain: string; displayName: string }>;
} = {}) {
  return {
    identityId: "id-1",
    email: "person@example.com",
    follows: [{ domain: "acme.com", displayName: "Acme" }],
    ...overrides,
  };
}

function groupWithJobs(domain: string, displayName: string, jobCount: number): FollowAlertGroup {
  return {
    domain,
    displayName,
    jobs: Array.from({ length: jobCount }, (_, i) => ({
      id: `${domain}-${i}`,
      title: `Role ${i}`,
      company: displayName,
      posted_ts: Date.now(),
    })) as FollowAlertGroup["jobs"],
  };
}

function baseDeps(overrides: Partial<SendEmailFollowDigestsDeps> = {}): SendEmailFollowDigestsDeps & {
  sends: unknown[];
} {
  const sends: unknown[] = [];
  return {
    listRecipients: async () => [recipient()],
    listNewRoles: async () => [],
    isEmailSuppressed: async () => false,
    signToken: (email) => `signed-${email}`,
    send: async (input) => {
      sends.push(input);
      return { sent: true, id: "email-1" };
    },
    sends,
    ...overrides,
  };
}

describe("sendEmailFollowDigests — excludeEmails dedupe", () => {
  it("skips a recipient whose normalized email is in excludeEmails, without calling send", async () => {
    const deps = baseDeps();
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set(["person@example.com"]) },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "skipped-excluded" }]);
    assert.equal(deps.sends.length, 0);
  });
});

describe("sendEmailFollowDigests — suppression", () => {
  it("skips a suppressed recipient without calling send", async () => {
    const deps = baseDeps({ isEmailSuppressed: async () => true });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set() },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "skipped-suppressed" }]);
    assert.equal(deps.sends.length, 0);
  });
});

describe("sendEmailFollowDigests — activity-only cadence", () => {
  it("reports skipped-empty when listNewRolesForFollows finds nothing, without calling send", async () => {
    const deps = baseDeps({ listNewRoles: async () => [] });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set() },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "skipped-empty" }]);
    assert.equal(deps.sends.length, 0);
  });
});

describe("sendEmailFollowDigests — happy path", () => {
  it("sends one email with a followed-company section and an unsubscribeUrl", async () => {
    const deps = baseDeps({ listNewRoles: async () => [groupWithJobs("acme.com", "Acme", 2)] });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set() },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "sent" }]);
    assert.equal(deps.sends.length, 1);
    const sent = deps.sends[0] as { to: string; kind: string; unsubscribeUrl: string; html: string; text: string };
    assert.equal(sent.to, "person@example.com");
    assert.equal(sent.kind, "digest");
    assert.match(sent.unsubscribeUrl, /^https?:\/\/.+\/unsubscribe\?token=signed-person%40example\.com$/);
  });

  // Beyond-primary case: a recipient following two companies with new roles
  // gets exactly one email covering both, not two sends.
  it("a recipient following two companies with new roles still gets exactly one email", async () => {
    const deps = baseDeps({
      listRecipients: async () => [
        recipient({
          follows: [
            { domain: "acme.com", displayName: "Acme" },
            { domain: "globex.com", displayName: "Globex" },
          ],
        }),
      ],
      listNewRoles: async () => [groupWithJobs("acme.com", "Acme", 1), groupWithJobs("globex.com", "Globex", 1)],
    });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set() },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "sent" }]);
    assert.equal(deps.sends.length, 1, "one recipient must produce exactly one send, regardless of follow count");
  });
});

describe("sendEmailFollowDigests — multiple recipients", () => {
  it("evaluates each recipient independently", async () => {
    const deps = baseDeps({
      listRecipients: async () => [
        recipient({ email: "a@example.com" }),
        recipient({ email: "b@example.com" }),
      ],
      listNewRoles: async () => [groupWithJobs("acme.com", "Acme", 1)],
    });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set(["a@example.com"]) },
      deps,
    );
    assert.deepEqual(results, [
      { email: "a@example.com", result: "skipped-excluded" },
      { email: "b@example.com", result: "sent" },
    ]);
    assert.equal(deps.sends.length, 1);
  });
});

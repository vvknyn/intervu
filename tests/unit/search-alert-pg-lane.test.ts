import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import type { PublicJob } from "../../src/lib/jobs/types";
import {
  buildDigestSectionsForRecipient,
  sendEmailFollowDigests,
  type SendEmailFollowDigestsDeps,
} from "../../src/lib/email/digest/pg-lane";
import type { EmailDigestRecipient } from "../../src/lib/identity/store";

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
before(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
});
after(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

class FakeQueryable implements Queryable {
  async query<R = Record<string, unknown>>(): Promise<{ rows: R[] }> {
    throw new Error("FakeQueryable: not used directly");
  }
}

function job(id: string): PublicJob {
  return {
    id,
    title: `Role ${id}`,
    company: "Acme",
    posted_ts: Date.now(),
  } as PublicJob;
}

function recipient(overrides: Partial<EmailDigestRecipient> = {}): EmailDigestRecipient {
  return {
    identityId: "id-1",
    email: "person@example.com",
    follows: [{ domain: "acme.com", displayName: "Acme" }],
    savedSearches: [{ name: "Staff engineer", href: "/jobs?q=staff", searchHash: "abc" }],
    ...overrides,
  };
}

function baseDeps(overrides: Partial<SendEmailFollowDigestsDeps> = {}): SendEmailFollowDigestsDeps & {
  sends: unknown[];
} {
  const sends: unknown[] = [];
  return {
    listRecipients: async () => [recipient()],
    listNewRolesForFollows: async () => [],
    listNewRolesForSavedSearch: async () => [],
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

describe("buildDigestSectionsForRecipient — combined sections", () => {
  it("includes both followed-company and saved-search sections", async () => {
    const sections = await buildDigestSectionsForRecipient(
      {
        sinceIso: "2026-08-01T00:00:00Z",
        recipient: recipient(),
        siteUrl: "https://intervuhq.com",
      },
      {
        listNewRolesForFollows: async () => [
          {
            domain: "acme.com",
            displayName: "Acme",
            jobs: [job("a-1")],
          },
        ],
        listNewRolesForSavedSearch: async () => [job("s-1")],
      },
    );
    assert.equal(sections.length, 2);
    assert.equal(sections[0].kind, "followed-company");
    assert.equal(sections[1].kind, "saved-search");
    assert.equal(sections[1].name, "Staff engineer");
  });

  it("saved-search-only recipient gets one saved-search section", async () => {
    const sections = await buildDigestSectionsForRecipient(
      {
        sinceIso: "2026-08-01T00:00:00Z",
        recipient: recipient({ follows: [] }),
        siteUrl: "https://intervuhq.com",
      },
      {
        listNewRolesForFollows: async () => [],
        listNewRolesForSavedSearch: async () => [job("s-1"), job("s-2")],
      },
    );
    assert.equal(sections.length, 1);
    assert.equal(sections[0].kind, "saved-search");
    assert.equal(sections[0].items.length, 2);
  });
});

describe("sendEmailFollowDigests — saved-search lane", () => {
  it("sends when only saved searches have new roles", async () => {
    const deps = baseDeps({
      listRecipients: async () => [recipient({ follows: [] })],
      listNewRolesForSavedSearch: async () => [job("s-1")],
    });
    const results = await sendEmailFollowDigests(
      { q: new FakeQueryable(), sinceIso: "2026-08-01T00:00:00Z", excludeEmails: new Set() },
      deps,
    );
    assert.deepEqual(results, [{ email: "person@example.com", result: "sent" }]);
    assert.equal(deps.sends.length, 1);
  });
});

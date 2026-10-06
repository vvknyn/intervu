import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseOnlyList, selectCampaignRecipients, type CampaignCandidate } from "@/lib/marketing/recipients";

const CANDIDATES: CampaignCandidate[] = [
  { userId: "u1", email: "alice@example.com", firstName: "Alice" },
  { userId: "u2", email: "bob@example.com", firstName: "Bob" },
  { userId: "u3", email: "carol@example.com", firstName: "Carol" },
];

describe("selectCampaignRecipients", () => {
  it("keeps every candidate when nothing is suppressed or already sent", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(),
      alreadySentUserIds: new Set(),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u1", "u2", "u3"]);
  });

  it("excludes a candidate already recorded as sent for this campaign, by user id", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(),
      alreadySentUserIds: new Set(["u2"]),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u1", "u3"]);
  });

  it("excludes a suppressed candidate by normalized email — a class case distinct from already-sent", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(["carol@example.com"]),
      alreadySentUserIds: new Set(),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u1", "u2"]);
  });

  it("matches suppression case-insensitively against the candidate's email", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(["Alice@Example.com".toLowerCase()]),
      alreadySentUserIds: new Set(),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u2", "u3"]);
  });

  it("applies both exclusions together without double-counting or reordering", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(["bob@example.com"]),
      alreadySentUserIds: new Set(["u3"]),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u1"]);
  });

  it("an empty candidate list returns an empty list, not an error", () => {
    assert.deepEqual(selectCampaignRecipients([], { suppressedEmails: new Set(), alreadySentUserIds: new Set() }), []);
  });
});

describe("unverified addresses and the --only list", () => {
  it("leaves out an address WorkOS says was never verified, and keeps one whose status is unknown", () => {
    const result = selectCampaignRecipients(
      [...CANDIDATES.slice(0, 2), { userId: "u4", email: "dave@example.com", firstName: null, emailVerified: false }, { userId: "u5", email: "erin@example.com", firstName: null, emailVerified: true }],
      { suppressedEmails: new Set(), alreadySentUserIds: new Set() },
    );
    assert.deepEqual(result.map((r) => r.userId), ["u1", "u2", "u5"]);
  });

  it("sends only to the reviewed list, still minus suppressed addresses", () => {
    const result = selectCampaignRecipients(CANDIDATES, {
      suppressedEmails: new Set(["carol@example.com"]),
      alreadySentUserIds: new Set(),
      onlyEmails: parseOnlyList("# reviewed 2026-10-05\nAlice@Example.com\n\ncarol@example.com  # left in\n"),
    });
    assert.deepEqual(result.map((r) => r.userId), ["u1"]);
  });

  it("refuses a CSV row or a name instead of guessing which part is the address", () => {
    assert.throws(() => parseOnlyList("email,name,send\nalice@example.com,Alice,no\n"), /line 1 is not a single email address/);
    assert.throws(() => parseOnlyList("Alice <alice@example.com>"), /not a single email address/);
    assert.throws(() => parseOnlyList("# nothing here\n"), /no addresses/);
  });
});

describe("selectCampaignRecipients: listed addresses outside the usual filters", () => {
  const unverified: CampaignCandidate = { userId: "u-unverified", email: "unverified@example.com", firstName: null, emailVerified: false };
  const untagged: CampaignCandidate = { userId: "u-untagged", email: "untagged@example.com", firstName: null, velaiAccount: false };
  const tagged: CampaignCandidate = { userId: "u-tagged", email: "tagged@example.com", firstName: null, velaiAccount: true };
  const base = { suppressedEmails: new Set<string>(), alreadySentUserIds: new Set<string>() };

  it("leaves out never-verified and untagged accounts by default, even when listed", () => {
    const onlyEmails = new Set(["unverified@example.com", "untagged@example.com", "tagged@example.com"]);
    const picked = selectCampaignRecipients([unverified, untagged, tagged], { ...base, onlyEmails });
    assert.deepEqual(picked.map((c) => c.userId), ["u-tagged"]);
  });

  it("sends to them when the list names them and the include flags are set", () => {
    const onlyEmails = new Set(["unverified@example.com", "untagged@example.com"]);
    const picked = selectCampaignRecipients([unverified, untagged, tagged], {
      ...base,
      onlyEmails,
      includeUnverified: true,
      includeUntagged: true,
    });
    assert.deepEqual(picked.map((c) => c.userId), ["u-unverified", "u-untagged"]);
  });

  it("still skips a listed address that unsubscribed or already got it", () => {
    const onlyEmails = new Set(["unverified@example.com", "untagged@example.com"]);
    const picked = selectCampaignRecipients([unverified, untagged], {
      suppressedEmails: new Set(["unverified@example.com"]),
      alreadySentUserIds: new Set(["u-untagged"]),
      onlyEmails,
      includeUnverified: true,
      includeUntagged: true,
    });
    assert.deepEqual(picked, []);
  });

  it("refuses the include flags without an --only list, so they can't widen a whole-list send", () => {
    assert.throws(() => selectCampaignRecipients([unverified], { ...base, includeUnverified: true }), /need an --only list/);
    assert.throws(() => selectCampaignRecipients([untagged], { ...base, includeUntagged: true }), /need an --only list/);
  });
});

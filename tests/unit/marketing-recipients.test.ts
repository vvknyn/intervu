import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectCampaignRecipients, type CampaignCandidate } from "@/lib/marketing/recipients";

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

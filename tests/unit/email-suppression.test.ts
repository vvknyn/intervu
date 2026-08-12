import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isSuppressedForKind, type SuppressionEntries } from "@/lib/email/suppression";

describe("isSuppressedForKind — pure decision", () => {
    it("no entries at all: nothing is suppressed", () => {
        assert.equal(isSuppressedForKind(undefined, "digest"), false);
        assert.equal(isSuppressedForKind({}, "digest"), false);
    });

    it("a kind-scoped entry suppresses ONLY that kind", () => {
        const entries: SuppressionEntries = { digest: { reason: "unsubscribed", at: "2026-01-01" } };
        assert.equal(isSuppressedForKind(entries, "digest"), true);
        assert.equal(isSuppressedForKind(entries, "waitlist_confirm"), false);
        assert.equal(isSuppressedForKind(entries, "transactional"), false);
    });

    it('an "all" entry suppresses every kind', () => {
        const entries: SuppressionEntries = { all: { reason: "bounced", at: "2026-01-01" } };
        assert.equal(isSuppressedForKind(entries, "digest"), true);
        assert.equal(isSuppressedForKind(entries, "waitlist_confirm"), true);
        assert.equal(isSuppressedForKind(entries, "transactional"), true);
    });

    it('a kind-scoped entry alongside an unrelated kind entry does not cross-suppress', () => {
        const entries: SuppressionEntries = {
            waitlist_confirm: { reason: "unsubscribed", at: "2026-01-01" },
        };
        assert.equal(isSuppressedForKind(entries, "digest"), false);
    });

    it('both a kind entry and "all" present: still suppressed (all wins, never a false negative)', () => {
        const entries: SuppressionEntries = {
            digest: { reason: "unsubscribed", at: "2026-01-01" },
            all: { reason: "complained", at: "2026-01-02" },
        };
        assert.equal(isSuppressedForKind(entries, "transactional"), true);
    });
});

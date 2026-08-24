import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isMintedLoginEmail, isReachableEmail, usernameEmail } from "@/lib/auth/username-email";
import { resolveAccountEmailRequest, resolveEmailNudgeState } from "@/lib/auth/account-email";
import {
    ACCOUNT_EMAIL_TOKEN_TTL_MS,
    signAccountEmailToken,
    verifyAccountEmailToken,
} from "@/lib/email/account-email-token";
import { shouldPromptEmailNudge, NUDGE_AFTER_INTERACTIONS } from "@/lib/jobs/email-nudge";

/**
 * The bug all of this exists to fix: a legacy password signup carries a
 * SYNTHESIZED `<username>@intervu.cc` address. It is non-empty, so a
 * `!user?.email` guard passes, and the settings page reported the weekly
 * digest as ON while send.ts dropped every send as `no-mailbox`.
 *
 * Truthy is not reachable. These tests hold that distinction at each layer
 * that has to agree about it.
 */

const TEST_KEY = "a".repeat(64); // 32 bytes hex
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("isReachableEmail", () => {
    it("rejects a minted address even though it is a non-empty string", () => {
        const minted = usernameEmail("vvk");
        // The precondition that made the original bug invisible.
        assert.equal(Boolean(minted), true);
        assert.equal(isMintedLoginEmail(minted), true);
        assert.equal(isReachableEmail(minted), false);
    });

    it("accepts a real address and rejects empty ones", () => {
        assert.equal(isReachableEmail("person@example.com"), true);
        assert.equal(isReachableEmail(""), false);
        assert.equal(isReachableEmail(null), false);
        assert.equal(isReachableEmail(undefined), false);
    });

    it("is a property of the address, so case and subdomain shape don't fool it", () => {
        assert.equal(isReachableEmail("VVK@Intervu.CC"), false);
        // A different domain that merely CONTAINS the minted one is reachable.
        assert.equal(isReachableEmail("someone@notintervu.cc.example.com"), true);
    });
});

describe("resolveAccountEmailRequest", () => {
    it("accepts a valid address and normalises it", () => {
        const r = resolveAccountEmailRequest("  Person@Example.COM ", usernameEmail("vvk"));
        assert.deepEqual(r, { ok: true, email: "person@example.com" });
    });

    it("refuses one of our own minted addresses", () => {
        const r = resolveAccountEmailRequest(usernameEmail("someone"), usernameEmail("vvk"));
        assert.equal(r.ok, false);
    });

    it("refuses malformed input without throwing", () => {
        for (const bad of ["not-an-email", "", null, undefined, 42, {}]) {
            assert.equal(resolveAccountEmailRequest(bad, null).ok, false);
        }
    });

    /**
     * The case that separates this from `validateSignupEmail`: re-submitting
     * the address already on the account is a no-op, not a send. Reporting it
     * as success would tell someone to check an inbox for mail we never sent.
     */
    it("reports alreadySet when the address matches the current REAL one", () => {
        const r = resolveAccountEmailRequest("Person@Example.com", "person@example.com");
        assert.equal(r.ok, false);
        assert.equal("alreadySet" in r && r.alreadySet, true);
    });

    /**
     * And the inverse, which is the whole population this serves: the current
     * address is non-empty but minted, so it must NEVER count as "already
     * set" — that would refuse the one action these accounts need.
     */
    it("does not treat a minted current address as alreadySet", () => {
        const r = resolveAccountEmailRequest("person@example.com", usernameEmail("person"));
        assert.equal(r.ok, true);
    });
});

describe("resolveEmailNudgeState", () => {
    it("reachable wins regardless of a leftover pending value", () => {
        assert.equal(
            resolveEmailNudgeState({ reachable: true, pendingEmail: "x@example.com" }),
            "reachable",
        );
    });

    it("a submitted-but-unconfirmed address is NOT done", () => {
        assert.equal(
            resolveEmailNudgeState({ reachable: false, pendingEmail: "x@example.com" }),
            "pending-confirmation",
        );
    });

    it("nothing submitted yet asks for an address", () => {
        assert.equal(resolveEmailNudgeState({ reachable: false, pendingEmail: null }), "needs-email");
    });
});

describe("account email token", () => {
    const NOW = 1_700_000_000_000;

    it("round-trips uid + normalised email", () => {
        const token = signAccountEmailToken("uid-123", "Person@Example.com", NOW);
        assert.ok(token);
        assert.deepEqual(verifyAccountEmailToken(token, NOW + 1000), {
            uid: "uid-123",
            email: "person@example.com",
        });
    });

    /**
     * Firebase uids are opaque. Splitting the payload from the LEFT would
     * shift every field for a uid containing a colon and silently attach the
     * address to a truncated account id.
     */
    it("survives a uid containing colons", () => {
        const uid = "tenant:eu:user:99";
        const token = signAccountEmailToken(uid, "a@b.com", NOW);
        assert.deepEqual(verifyAccountEmailToken(token, NOW), { uid, email: "a@b.com" });
    });

    it("rejects a tampered payload", () => {
        const token = signAccountEmailToken("uid-123", "person@example.com", NOW)!;
        const [encoded, sig] = token.split(".");
        const forged = Buffer.from("uid-999:attacker@evil.com:" + NOW, "utf8").toString("base64url");
        assert.equal(verifyAccountEmailToken(`${forged}.${sig}`, NOW), null);
        assert.equal(verifyAccountEmailToken(`${encoded}.${"z".repeat(sig.length)}`, NOW), null);
    });

    /**
     * `timingSafeEqual` THROWS on a length mismatch rather than returning
     * false, so an attacker-controlled signature length must be rejected by
     * the length check first — otherwise this is a 500, not a clean refusal.
     */
    it("rejects a wrong-length signature without throwing", () => {
        const token = signAccountEmailToken("uid-123", "person@example.com", NOW)!;
        const encoded = token.split(".")[0];
        assert.doesNotThrow(() => verifyAccountEmailToken(`${encoded}.short`, NOW));
        assert.equal(verifyAccountEmailToken(`${encoded}.short`, NOW), null);
    });

    it("expires, and rejects a future-dated payload", () => {
        const token = signAccountEmailToken("uid-123", "person@example.com", NOW)!;
        assert.ok(verifyAccountEmailToken(token, NOW + ACCOUNT_EMAIL_TOKEN_TTL_MS - 1));
        assert.equal(verifyAccountEmailToken(token, NOW + ACCOUNT_EMAIL_TOKEN_TTL_MS + 1), null);
        // Only we mint these, so a token from the future means an edited payload.
        assert.equal(verifyAccountEmailToken(token, NOW - 1), null);
    });

    it("rejects malformed shapes without throwing", () => {
        for (const bad of [null, undefined, "", "nodot", ".", ".sig", "abc."]) {
            assert.doesNotThrow(() => verifyAccountEmailToken(bad, NOW));
            assert.equal(verifyAccountEmailToken(bad, NOW), null);
        }
    });

    it("no ENCRYPTION_KEY: sign and verify both no-op to null, never throw", () => {
        const token = signAccountEmailToken("uid-123", "person@example.com", NOW)!;
        delete process.env.ENCRYPTION_KEY;
        assert.equal(signAccountEmailToken("uid-123", "person@example.com", NOW), null);
        assert.equal(verifyAccountEmailToken(token, NOW), null);
    });
});

describe("shouldPromptEmailNudge", () => {
    const base = {
        signedIn: true,
        needsEmail: true,
        dismissed: false,
        interactions: NUDGE_AFTER_INTERACTIONS,
    };

    it("asks a signed-in, unreachable account that has searched enough", () => {
        assert.equal(shouldPromptEmailNudge(base), true);
    });

    it("never asks a signed-out visitor — that's the wizard's job", () => {
        // Even with everything else screaming yes.
        assert.equal(
            shouldPromptEmailNudge({ ...base, signedIn: false, interactions: 99 }),
            false,
        );
    });

    it("never asks an account we can already reach", () => {
        assert.equal(shouldPromptEmailNudge({ ...base, needsEmail: false }), false);
    });

    it("stays quiet once dismissed", () => {
        assert.equal(shouldPromptEmailNudge({ ...base, dismissed: true }), false);
    });

    it("waits for the interaction threshold", () => {
        assert.equal(
            shouldPromptEmailNudge({ ...base, interactions: NUDGE_AFTER_INTERACTIONS - 1 }),
            false,
        );
    });

    /**
     * The two prompts must never both fire. The wizard requires signedIn
     * false; this requires signedIn true — so the exclusion is structural,
     * not a matter of ordering at the call site.
     */
    it("is mutually exclusive with the signed-out wizard by construction", () => {
        assert.equal(shouldPromptEmailNudge({ ...base, signedIn: false }), false);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveWelcomeEligibility } from "@/lib/email/welcome";
import { buildWelcomeEmail } from "@/lib/email/templates/welcome";
import { usernameEmail, isMintedLoginEmail, USERNAME_EMAIL_DOMAIN } from "@/lib/auth/username-email";
import { emailKindPolicy } from "@/lib/email/types";

const SITE = "https://intervuhq.com";
const UNSUB = "https://intervuhq.com/unsubscribe?token=abc";

describe("username-email — minter and detector are one source", () => {
    // The property, not one example: ANY username the minter accepts must
    // come back as minted. A detector that agrees with the minter on
    // "vivek" but not on "v.i-v_ek" is a detector that will eventually
    // green-light a hard bounce.
    it("every address the minter produces is detected as minted", () => {
        for (const username of ["vivek", "a", "with.dot", "with-dash", "with_underscore", "MiXeDcAsE", "123"]) {
            assert.equal(isMintedLoginEmail(usernameEmail(username)), true, username);
        }
    });

    it("addresses a person actually gave us are not minted", () => {
        for (const real of [
            "vivek@gmail.com",
            "someone@intervuhq.com",
            // The bare domain is a real mail domain the company owns; only
            // the login-mint SUBADDRESS shape is synthetic. A lookalike that
            // merely CONTAINS the domain must not be swallowed.
            `person@notintervu.cc`,
            `person@sub.${USERNAME_EMAIL_DOMAIN}.example.com`,
        ]) {
            assert.equal(isMintedLoginEmail(real), false, real);
        }
    });

    it("is case- and whitespace-insensitive, matching every other email lookup key", () => {
        assert.equal(isMintedLoginEmail(`  Vivek@INTERVU.CC  `), true);
    });

    it("treats a missing address as not-minted, leaving that case to the eligibility gate", () => {
        assert.equal(isMintedLoginEmail(null), false);
        assert.equal(isMintedLoginEmail(undefined), false);
        assert.equal(isMintedLoginEmail(""), false);
    });
});

describe("resolveWelcomeEligibility", () => {
    it("accepts a real address", () => {
        assert.equal(resolveWelcomeEligibility("vivek@gmail.com"), null);
    });

    it("refuses a missing address", () => {
        assert.equal(resolveWelcomeEligibility(null), "no-email");
        assert.equal(resolveWelcomeEligibility(undefined), "no-email");
        assert.equal(resolveWelcomeEligibility(""), "no-email");
    });

    // The load-bearing one. Every password account carries a synthesized
    // address with no mailbox behind it, so sending there is a guaranteed
    // hard bounce — and bounce rate is the single largest input to a
    // sending domain's reputation, which the digest then inherits.
    it("refuses an address the signup flow minted — sending there is a guaranteed hard bounce", () => {
        assert.equal(resolveWelcomeEligibility(usernameEmail("vivek")), "minted-login-email");
    });
});

describe("welcome email policy", () => {
    // Not "transactional". The email describes what the product does, which
    // is promotional content however it was triggered — so it must respect
    // an existing opt-out and must carry List-Unsubscribe.
    it("is suppressible and carries an unsubscribe header", () => {
        const policy = emailKindPolicy("welcome");
        assert.equal(policy.suppressible, true);
        assert.equal(policy.requiresUnsubscribeHeader, true);
    });
});

describe("buildWelcomeEmail", () => {
    const email = buildWelcomeEmail({ siteUrl: SITE, unsubscribeUrl: UNSUB });

    it("carries the unsubscribe link in BOTH the html and the text alternative", () => {
        assert.ok(email.html.includes(UNSUB));
        assert.ok(email.text.includes(UNSUB));
    });

    // The row chip stopped claiming verification on 2026-08-16 because
    // nothing here verifies that a posting is genuine. An email is the one
    // surface that can't be re-rendered after it ships, so the claim must
    // not reappear in the first thing a new account ever reads.
    it("never claims a posting is verified", () => {
        assert.doesNotMatch(email.subject, /verified/i);
        assert.doesNotMatch(email.html, /verified/i);
        assert.doesNotMatch(email.text, /verified/i);
    });

    // A live corpus count is true on send day and wrong forever after.
    it("states no corpus size that could go stale in an unrecallable email", () => {
        assert.doesNotMatch(email.text, /[\d,]{4,}\s*(live\s*)?(roles|jobs)/i);
    });

    it("builds every link from the passed site url — no hardcoded domain", () => {
        assert.doesNotMatch(email.html.replace(new RegExp(SITE, "g"), ""), /https?:\/\/(?!intervuhq\.com\/unsubscribe)/);
        for (const path of ["/jobs", "/yours", "/connect"]) {
            assert.ok(email.text.includes(`${SITE}${path}`), path);
        }
    });

    it("names the two things that bring someone back — a saved search and the tracker", () => {
        assert.match(email.text, /save a search/i);
        assert.match(email.text, /track/i);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { screenSignupEmail, assessSignupEmail, emailDomain, type EmailQualityDeps } from "@/lib/auth/email-quality";

/**
 * `screenSignupEmail` is the cheap sync half `validateSignupEmail`
 * (username-email.ts) folds in, and the same call the OAuth observe-only
 * hook in provisioning.ts makes. Exercised directly here so both callers
 * stay covered by one set of cases instead of drifting into two.
 */
describe("screenSignupEmail: disposable domains", () => {
    it("rejects a known disposable domain", () => {
        assert.equal(screenSignupEmail("x@mailinator.com"), "disposable");
    });

    // Not the same string as the case above — proves mailchecker's parent-
    // domain matching, not just a literal-domain compare.
    it("rejects a subdomain of a known disposable domain", () => {
        assert.equal(screenSignupEmail("x@foo.mailinator.com"), "disposable");
    });

    for (const domain of ["gmail.com", "outlook.com", "proton.me", "icloud.com", "hey.com"]) {
        it(`does not flag ${domain} as disposable`, () => {
            assert.notEqual(screenSignupEmail(`x@${domain}`), "disposable");
        });
    }
});

describe("screenSignupEmail: syntax", () => {
    const badCases: Record<string, string> = {
        "no TLD": "a@b",
        "double @": "a@@b.com",
        "domain starts with a dot": "a@.b.com",
        "local part has a double dot": "a..b@c.com",
        "local part over 64 chars": `${"a".repeat(65)}@b.com`,
    };

    for (const [label, email] of Object.entries(badCases)) {
        it(`rejects ${label}`, () => {
            assert.equal(screenSignupEmail(email), "syntax", email);
        });
    }

    it("accepts a well-formed, non-disposable address", () => {
        assert.equal(screenSignupEmail("vivek@gmail.com"), null);
    });
});

describe("emailDomain", () => {
    it("extracts the domain after the last '@'", () => {
        assert.equal(emailDomain("vivek@gmail.com"), "gmail.com");
    });

    it("returns null when there is no '@'", () => {
        assert.equal(emailDomain("not-an-email"), null);
    });
});

/**
 * `assessSignupEmail` adds the DNS deliverability step on top of
 * `screenSignupEmail`. All four resolver outcomes below are exercised
 * against fakes — the SOLID seam `EmailQualityDeps` exists for exactly this,
 * never a real DNS server in a unit test.
 */
function noDataError(): NodeJS.ErrnoException {
    return Object.assign(new Error("queryMx ENODATA"), { code: "ENODATA" });
}

function servfailError(): NodeJS.ErrnoException {
    return Object.assign(new Error("queryMx ESERVFAIL"), { code: "ESERVFAIL" });
}

function hangingDeps(overrides: Partial<EmailQualityDeps> = {}): EmailQualityDeps {
    return {
        resolveMx: () => new Promise(() => {}),
        resolveAddress: () => new Promise(() => {}),
        timeoutMs: 50,
        ...overrides,
    };
}

describe("assessSignupEmail: DNS deliverability", () => {
    it("accepts a domain with an MX record", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => [{ exchange: "mail.example.com" }],
            resolveAddress: async () => {
                throw new Error("should not be called when MX exists");
            },
        };
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), { ok: true });
    });

    it("falls back to A/AAAA and accepts when no MX but an address exists (RFC 5321)", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => {
                throw noDataError();
            },
            resolveAddress: async () => ["93.184.216.34"],
        };
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), { ok: true });
    });

    it("rejects with no_mail_host when neither MX nor A/AAAA exist", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => {
                throw noDataError();
            },
            resolveAddress: async () => {
                throw noDataError();
            },
        };
        assert.deepEqual(await assessSignupEmail("x@nowhere.invalid", deps), {
            ok: false,
            reason: "no_mail_host",
        });
    });

    it("fails open when the resolver errors with something other than no-records (SERVFAIL)", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => {
                throw servfailError();
            },
            resolveAddress: async () => {
                throw new Error("should not be called after a hard MX error");
            },
        };
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), { ok: true });
    });

    it("fails open when the resolver hangs past the timeout", async () => {
        const deps = hangingDeps();
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), { ok: true });
    });

    it("still rejects on a syntax problem without ever calling the resolver", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => {
                throw new Error("should not be called for a malformed address");
            },
            resolveAddress: async () => {
                throw new Error("should not be called for a malformed address");
            },
        };
        assert.deepEqual(await assessSignupEmail("not-an-email", deps), { ok: false, reason: "syntax" });
    });
});

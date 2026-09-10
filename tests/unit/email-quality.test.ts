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
        // A stray space is a syntax defect, not a disposable-domain match —
        // gmail.com is never on mailchecker's list, so if this ever comes
        // back "disposable" it means the two syntax checkers disagreed and
        // screenSignupEmail let mailchecker's stricter regex decide instead.
        "space in local part": "a b@gmail.com",
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

/**
 * RFC 7505: a domain can publish a single MX record whose exchange is "."
 * to affirmatively declare it accepts no mail at all. That's a stronger
 * signal than "no MX record" (which still gets the A/AAAA fallback below) —
 * it's a closed rejection with no fallback attempted.
 */
describe("assessSignupEmail: RFC 7505 null MX", () => {
    it("rejects a domain whose only MX record is the null-MX exchange '.'", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => [{ exchange: "." }],
            resolveAddress: async () => {
                throw new Error("should not fall through to A/AAAA for a null MX");
            },
        };
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), {
            ok: false,
            reason: "no_mail_host",
        });
    });

    it("accepts a mixed MX answer that has a real exchange alongside a null-MX record", async () => {
        const deps: EmailQualityDeps = {
            resolveMx: async () => [{ exchange: "mail.example.com" }, { exchange: "." }],
            resolveAddress: async () => {
                throw new Error("should not be called when a real MX exists");
            },
        };
        assert.deepEqual(await assessSignupEmail("x@example.com", deps), { ok: true });
    });
});

/**
 * `timeoutMs` must bound the WHOLE call, not each sequential lookup on its
 * own — otherwise a domain with slow-but-answering DNS could burn close to
 * 2×`timeoutMs` (MX lookup, then a fresh budget for the A/AAAA fallback).
 */
describe("assessSignupEmail: single deadline across sequential lookups", () => {
    it("bounds total elapsed time by timeoutMs when a fast MX answer falls through to a hanging A/AAAA lookup", async () => {
        const timeoutMs = 100;
        const deps: EmailQualityDeps = {
            resolveMx: () => new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs * 0.6)),
            resolveAddress: () => new Promise(() => {}), // never resolves
            timeoutMs,
        };
        const start = Date.now();
        const result = await assessSignupEmail("x@example.com", deps);
        const elapsed = Date.now() - start;
        assert.deepEqual(result, { ok: true });
        assert.ok(
            elapsed < timeoutMs * 1.2,
            `expected total elapsed (${elapsed}ms) to stay under 1.2x timeoutMs (${timeoutMs * 1.2}ms) instead of ~2x`,
        );
    });
});

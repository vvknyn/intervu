import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildWelcomeEmail } from "@/lib/email/templates/welcome";
import { buildWaitlistConfirmEmail } from "@/lib/email/templates/waitlist-confirm";
import { buildDigestEmail } from "@/lib/email/templates/digest";
import { buildDailyPicksEmail } from "@/lib/email/templates/daily-picks";
import { verifyFollowEmailContent } from "@/lib/email/verify-follow";

/**
 * `intervuhq.com` publishes NO MX record (verified 2026-08-17 —
 * `dig MX intervuhq.com` returns nothing). Resend is a sending service and
 * gives the domain no inbox, so mail addressed to `hello@intervuhq.com`
 * fails at the sender's own server. Any email that tells a reader to reply
 * is therefore offering a channel that does not exist.
 *
 * The welcome email did exactly that, and the comment above the line
 * asserted the opposite ("RESEND_FROM is a real address ... so inviting the
 * reply is honest") on the strength of the address existing in config. An
 * address existing in `RESEND_FROM` says nothing about whether the domain
 * can receive.
 *
 * This is a class guard rather than a fix to the one line: it fails for a
 * template that did not exist when the bug was found, which is the point.
 * If inbound mail is ever set up, delete this file — do not weaken it to
 * exempt one template.
 */
const TEMPLATES: Record<string, () => { html: string; text: string }> = {
    welcome: () =>
        buildWelcomeEmail({ siteUrl: "https://intervuhq.com", unsubscribeUrl: "https://intervuhq.com/unsubscribe?t=x" }),
    "waitlist-confirm": () =>
        buildWaitlistConfirmEmail({
            whatSignedUpFor: "the Hunt credit pack",
            unsubscribeUrl: "https://intervuhq.com/unsubscribe?t=x",
            siteUrl: "https://intervuhq.com",
        }),
    digest: () =>
        buildDigestEmail({
            unsubscribeUrl: "https://intervuhq.com/unsubscribe?t=x",
            siteUrl: "https://intervuhq.com",
            sections: [
                {
                    kind: "saved-search",
                    name: "staff engineer",
                    items: [{ title: "Staff Engineer", company: "Acme", href: "https://intervuhq.com/jobs/1", location: "Remote" }],
                    totalNew: 1,
                    mayHaveMore: false,
                    seeAllHref: "https://intervuhq.com/jobs?q=staff+engineer",
                },
            ],
        }),
    "daily-picks": () =>
        buildDailyPicksEmail({
            unsubscribeUrl: "https://intervuhq.com/unsubscribe?t=x",
            siteUrl: "https://intervuhq.com",
            picks: [
                {
                    title: "Staff Engineer",
                    employer: "Acme",
                    location: "Remote",
                    salary: null,
                    fit: "Strong",
                    why: "Your role, at your level",
                    href: "https://intervuhq.com/jobs/1",
                },
            ],
        }),
    "verify-follow": () =>
        verifyFollowEmailContent({
            companyName: "Acme",
            verifyUrl: "https://intervuhq.com/api/follow-email/verify?token=x",
        }),
};

describe("no email offers a reply channel the domain cannot receive on", () => {
    for (const [name, build] of Object.entries(TEMPLATES)) {
        it(`${name} never tells the reader to reply`, () => {
            const { html, text } = build();
            for (const [surface, body] of [["html", html], ["text", text]] as const) {
                assert.doesNotMatch(
                    body,
                    /\breply\b|\bwrite back\b|\brespond to this (email|message)\b/i,
                    `${name} ${surface} invites a reply, but ${"intervuhq.com"} has no MX record`,
                );
            }
        });
    }

    // The replacement has to actually go somewhere. A guard that only forbids
    // the reply would pass just as happily on an email that offers no way to
    // reach anyone at all, which is the same dead end wearing different words.
    it("welcome points at the contact form instead", () => {
        const { html, text } = buildWelcomeEmail({
            siteUrl: "https://intervuhq.com",
            unsubscribeUrl: "https://intervuhq.com/unsubscribe?t=x",
        });
        assert.match(text, /https:\/\/intervuhq\.com\/contact/);
        assert.match(html, /href="https:\/\/intervuhq\.com\/contact"/);
    });
});

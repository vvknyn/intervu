import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDigestEmail } from "@/lib/email/templates/digest";
import type { DigestModel } from "@/lib/email/digest/assemble";

function model(overrides: Partial<DigestModel> = {}): DigestModel {
    return {
        sections: [
            {
                kind: "followed-company",
                name: "Acme",
                items: [{ title: "Engineer", company: "Acme", href: "https://intervuhq.com/jobs/engineer" }],
                totalNew: 1,
                mayHaveMore: false,
                seeAllHref: "https://intervuhq.com/co/acme",
            },
        ],
        unsubscribeUrl: "https://intervuhq.com/unsubscribe?token=abc",
        ...overrides,
    };
}

describe("buildDigestEmail", () => {
    it("subject states the exact count when nothing was capped by the fetch limit", () => {
        const { subject } = buildDigestEmail(model());
        assert.equal(subject, "1 new role this week");
    });

    it('subject uses a "+" suffix when a section hit its fetch cap — never a bare count that might undercount', () => {
        const m = model({
            sections: [
                {
                    kind: "followed-company",
                    name: "Acme",
                    items: [{ title: "Engineer", company: "Acme", href: "https://x/1" }],
                    totalNew: 10,
                    mayHaveMore: true,
                    seeAllHref: "https://x/co/acme",
                },
            ],
        });
        const { subject } = buildDigestEmail(m);
        assert.match(subject, /^10\+ new roles this week$/);
    });

    it("includes the unsubscribe url in both html and text bodies", () => {
        const { html, text } = buildDigestEmail(model());
        assert.match(html, /https:\/\/intervuhq\.com\/unsubscribe\?token=abc/);
        assert.match(text, /https:\/\/intervuhq\.com\/unsubscribe\?token=abc/);
    });

    it("escapes HTML-hostile job titles/companies (external, employer-supplied data)", () => {
        const m = model({
            sections: [
                {
                    kind: "followed-company",
                    name: "Acme",
                    items: [{ title: '<script>alert(1)</script>', company: "A&B", href: "https://x/1" }],
                    totalNew: 1,
                    mayHaveMore: false,
                    seeAllHref: "https://x/co/acme",
                },
            ],
        });
        const { html } = buildDigestEmail(m);
        assert.equal(html.includes("<script>alert(1)</script>"), false);
        assert.match(html, /&lt;script&gt;/);
        assert.match(html, /A&amp;B/);
    });
});

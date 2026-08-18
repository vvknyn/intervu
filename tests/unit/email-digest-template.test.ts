import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDigestEmail } from "@/lib/email/templates/digest";
import type { DigestModel, DigestSectionKind } from "@/lib/email/digest/assemble";

function model(overrides: Partial<DigestModel> = {}): DigestModel {
    return {
        sections: [
            {
                kind: "followed-company",
                name: "Acme",
                items: [{ title: "Engineer", company: "Acme", href: "https://intervuhq.com/jobs/engineer", location: "Remote" }],
                totalNew: 1,
                mayHaveMore: false,
                seeAllHref: "https://intervuhq.com/co/acme",
            },
        ],
        unsubscribeUrl: "https://intervuhq.com/unsubscribe?token=abc",
        siteUrl: "https://intervuhq.com",
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
                    items: [{ title: "Engineer", company: "Acme", href: "https://x/1", location: "Remote" }],
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
                    items: [{ title: '<script>alert(1)</script>', company: "A&B", href: "https://x/1", location: "Remote" }],
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

describe("buildDigestEmail — section headings say WHY a section is there", () => {
    function headingFor(kind: DigestSectionKind, name: string): string {
        const { text } = buildDigestEmail(
            model({
                sections: [
                    {
                        kind,
                        name,
                        items: [{ title: "Engineer", company: "Acme", href: "https://x/1", location: "Remote" }],
                        totalNew: 1,
                        mayHaveMore: false,
                        seeAllHref: "https://x/1",
                    },
                ],
            }),
        );
        // The em dash is what separates a SECTION heading ("Acme — 1 new
        // role") from the shell's own heading line ("1 new role this week"),
        // which also contains "new role" and now comes first in the text
        // body. Matching on "new role" alone silently returned the shell
        // heading for every case, so all four assertions compared the same
        // string and the drift guard below could never have failed.
        return text.split("\n").find((line) => line.includes("new role") && line.includes("—")) ?? "";
    }

    it("quotes a saved search's name — it is a string the reader typed", () => {
        assert.match(headingFor("saved-search", "Remote staff eng"), /"Remote staff eng" — 1 new role/);
    });

    it("leaves a followed company's name unquoted — it is the company's own name", () => {
        assert.match(headingFor("followed-company", "Acme"), /^Acme — 1 new role/);
    });

    // Without this the reader sees a heading for a company they never
    // followed and has no way to tell where it came from.
    it("says why an unfollowed company is here", () => {
        assert.match(headingFor("tracked-company", "Acme"), /^Acme \(in your tracker\) — 1 new role/);
    });

    it("renders the no-signal lane under its own plain label", () => {
        assert.match(headingFor("default", "New roles this week"), /^New roles this week — 1 new role/);
    });

    /**
     * The drift guard. The two company-shaped lanes search the same way and
     * render the same items, so the heading is the ONLY thing that tells a
     * reader whether they follow this company or merely have a role from it
     * in their tracker. `default` is deliberately not in this comparison —
     * its name is a fixed label, never a company name, so rendering it
     * plainly can't be confused with anything.
     */
    it("never words a tracked company the same way as a followed one", () => {
        assert.notEqual(headingFor("tracked-company", "Acme"), headingFor("followed-company", "Acme"));
    });
});

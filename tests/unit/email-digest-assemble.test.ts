import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assembleDigest, type RawDigestSection } from "@/lib/email/digest/assemble";

function item(title: string) {
    return { title, company: "Acme", href: `https://intervuhq.com/jobs/${title}` };
}

function section(overrides: Partial<RawDigestSection> = {}): RawDigestSection {
    return {
        kind: "followed-company",
        name: "Acme",
        items: [item("role-1")],
        mayHaveMore: false,
        seeAllHref: "https://intervuhq.com/co/acme",
        ...overrides,
    };
}

describe("assembleDigest", () => {
    it("empty input (no sections at all) assembles to null", () => {
        assert.equal(assembleDigest({ sections: [], unsubscribeUrl: "https://x/unsub" }), null);
    });

    it("sections present but every one has zero items assembles to null (never a hollow send)", () => {
        const result = assembleDigest({
            sections: [section({ items: [] }), section({ kind: "saved-search", name: "PM roles", items: [] })],
            unsubscribeUrl: "https://x/unsub",
        });
        assert.equal(result, null);
    });

    it("a single non-empty section produces a model with just that section", () => {
        const result = assembleDigest({
            sections: [section({ items: [item("role-1"), item("role-2")] })],
            unsubscribeUrl: "https://x/unsub",
        });
        assert.ok(result);
        assert.equal(result!.sections.length, 1);
        assert.equal(result!.sections[0].name, "Acme");
        assert.equal(result!.sections[0].totalNew, 2);
        assert.equal(result!.unsubscribeUrl, "https://x/unsub");
    });

    it("caps displayed items to the default cap (5) but keeps the real total", () => {
        const items = Array.from({ length: 8 }, (_, i) => item(`role-${i}`));
        const result = assembleDigest({
            sections: [section({ items, mayHaveMore: true })],
            unsubscribeUrl: "https://x/unsub",
        });
        assert.equal(result!.sections[0].items.length, 5);
        assert.equal(result!.sections[0].totalNew, 8);
        assert.equal(result!.sections[0].mayHaveMore, true);
    });

    it("honors a custom itemCap", () => {
        const items = Array.from({ length: 8 }, (_, i) => item(`role-${i}`));
        const result = assembleDigest({
            sections: [section({ items })],
            unsubscribeUrl: "https://x/unsub",
            itemCap: 2,
        });
        assert.equal(result!.sections[0].items.length, 2);
        assert.equal(result!.sections[0].totalNew, 8);
    });

    it("multiple sections: empty ones are dropped, non-empty ones all survive in order", () => {
        const result = assembleDigest({
            sections: [
                section({ name: "Acme", items: [item("a1")] }),
                section({ kind: "saved-search", name: "PM roles", items: [] }),
                section({ kind: "saved-search", name: "Remote eng", items: [item("b1"), item("b2")] }),
            ],
            unsubscribeUrl: "https://x/unsub",
        });
        assert.equal(result!.sections.length, 2);
        assert.deepEqual(
            result!.sections.map((s) => s.name),
            ["Acme", "Remote eng"],
        );
    });

    it("does not mutate its input", () => {
        const items = [item("role-1"), item("role-2"), item("role-3")];
        const original = section({ items });
        const snapshotLength = original.items.length;
        assembleDigest({ sections: [original], unsubscribeUrl: "https://x/unsub", itemCap: 1 });
        assert.equal(original.items.length, snapshotLength);
    });
});

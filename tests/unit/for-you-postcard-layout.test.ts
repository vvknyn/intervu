import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src/components/jobs/for-you");

function source(name: string): string {
    return readFileSync(join(ROOT, name), "utf8");
}

describe("for-you postcard layout", () => {
    it("caps ForYouHome to the viewport so the pack cannot grow with the JD", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /100dvh-var\(--topbar-h\)/);
        assert.match(home, /overflow-hidden/);
        assert.match(home, /data-testid="for-you-download-apply"/);
        assert.doesNotMatch(home, /fixed inset-x-0 bottom-0/);
    });

    it("sizes the deck to leftover flex space, not the full home column", () => {
        const deck = source("ForYouDeck.tsx");
        assert.match(deck, /relative min-h-0 flex-1 pb-6/);
        assert.doesNotMatch(deck, /className=\{cn\("relative h-full/);
    });

    it("keeps the pack a bounded postcard with inner JD scroll", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /h-full max-h-full min-h-0[\s\S]*overflow-hidden/);
        assert.match(pack, /data-pack-scroll/);
        assert.match(pack, /data-pack-scroll[\s\S]*overflow-y-auto/);
        assert.doesNotMatch(pack, /lg:min-h-\[420px\]/);
    });
});

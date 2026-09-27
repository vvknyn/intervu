import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    armFirstPackReveal,
    consumeFirstPackReveal,
    FIRST_PACK_REVEAL_KEY,
    setFirstPackRevealStorageForTests,
} from "../../src/lib/jobs/for-you/first-pack-reveal";

function makeMemorySessionStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear() {
            map.clear();
        },
        getItem(key: string) {
            return map.get(key) ?? null;
        },
        key(index: number) {
            return [...map.keys()][index] ?? null;
        },
        removeItem(key: string) {
            map.delete(key);
        },
        setItem(key: string, value: string) {
            map.set(key, value);
        },
    };
}

describe("first-pack-reveal session latch", () => {
    beforeEach(() => {
        setFirstPackRevealStorageForTests(makeMemorySessionStorage());
    });

    afterEach(() => {
        setFirstPackRevealStorageForTests(undefined);
    });

    it("arms and consumes once", () => {
        const storage = makeMemorySessionStorage();
        setFirstPackRevealStorageForTests(storage);
        armFirstPackReveal();
        assert.equal(storage.getItem(FIRST_PACK_REVEAL_KEY), "1");
        assert.equal(consumeFirstPackReveal(), true);
        assert.equal(consumeFirstPackReveal(), false);
        assert.equal(storage.getItem(FIRST_PACK_REVEAL_KEY), null);
    });

    it("consume is false when storage unavailable", () => {
        setFirstPackRevealStorageForTests(null);
        armFirstPackReveal();
        assert.equal(consumeFirstPackReveal(), false);
    });

    it("jobs page wires arm on onboarding complete and import", () => {
        const page = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");
        assert.match(page, /armFirstPackReveal\(\)/);
        assert.match(page, /consumeFirstPackReveal\(\)/);
        assert.match(page, /first-pack-reveal-handoff/);
    });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    LOCAL_AI_ENABLED_KEY,
    applyLocalAiSearchParam,
    readLocalAiEnabled,
    writeLocalAiEnabled,
} from "../../src/lib/local-ai/flag";

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;

beforeEach(() => {
    fakeLocalStorage.clear();
});

describe("local-ai flag", () => {
    it("defaults to disabled", () => {
        assert.equal(readLocalAiEnabled(), false);
    });

    it("writeLocalAiEnabled persists toggle", () => {
        writeLocalAiEnabled(true);
        assert.equal(fakeLocalStorage.getItem(LOCAL_AI_ENABLED_KEY), "1");
        assert.equal(readLocalAiEnabled(), true);
        writeLocalAiEnabled(false);
        assert.equal(readLocalAiEnabled(), false);
    });

    it("?localAi=1 enables and persists", () => {
        assert.equal(applyLocalAiSearchParam("1"), true);
        assert.equal(readLocalAiEnabled(), true);
    });

    it("absent param reads stored value only", () => {
        writeLocalAiEnabled(true);
        assert.equal(applyLocalAiSearchParam(null), true);
        writeLocalAiEnabled(false);
        assert.equal(applyLocalAiSearchParam(undefined), false);
    });
});

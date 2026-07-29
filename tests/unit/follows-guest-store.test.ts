import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

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

import {
    addGuestFollow,
    listGuestFollows,
    removeGuestFollow,
    clearGuestFollows,
    subscribeGuestFollows,
} from "../../src/lib/follows/guest-store";

const acme = { domain: "acme.com", slug: "acme", displayName: "Acme Corp" };
const beta = { domain: "beta.io", slug: "beta", displayName: "Beta Inc" };

beforeEach(() => {
    clearGuestFollows();
});

test("listGuestFollows is empty on a fresh store", () => {
    assert.deepEqual(listGuestFollows(), []);
});

test("addGuestFollow round-trips through localStorage", () => {
    addGuestFollow(acme);
    const list = listGuestFollows();
    assert.equal(list.length, 1);
    assert.equal(list[0].domain, "acme.com");
    assert.equal(list[0].slug, "acme");
    assert.equal(list[0].displayName, "Acme Corp");
    assert.ok(list[0].createdAt);
});

test("addGuestFollow for the same domain updates metadata without duplicating", () => {
    addGuestFollow(acme);
    const first = listGuestFollows()[0].createdAt;
    addGuestFollow({ domain: "acme.com", slug: "acme-corp", displayName: "Acme Corporation" });

    const list = listGuestFollows();
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, "acme-corp");
    assert.equal(list[0].displayName, "Acme Corporation");
    assert.equal(list[0].createdAt, first);
});

test("removeGuestFollow removes only the targeted domain", () => {
    addGuestFollow(acme);
    addGuestFollow(beta);

    removeGuestFollow("acme.com");

    const list = listGuestFollows();
    assert.equal(list.length, 1);
    assert.equal(list[0].domain, "beta.io");
});

test("subscribeGuestFollows notifies on add and remove", () => {
    let calls = 0;
    const unsub = subscribeGuestFollows(() => {
        calls++;
    });

    addGuestFollow(acme);
    assert.equal(calls, 1);

    removeGuestFollow("acme.com");
    assert.equal(calls, 2);

    unsub();
    addGuestFollow(beta);
    assert.equal(calls, 2);
});

test("a corrupt localStorage value degrades to an empty list", () => {
    fakeLocalStorage.setItem("intervu.follows.guest", "{not json");
    assert.deepEqual(listGuestFollows(), []);
});

test("addGuestFollow normalizes domain casing and whitespace", () => {
    addGuestFollow({ domain: "  Acme.COM  ", slug: "acme", displayName: "Acme Corp" });
    const list = listGuestFollows();
    assert.equal(list.length, 1);
    assert.equal(list[0].domain, "acme.com");
});

test("removeGuestFollow matches normalized domain keys", () => {
    addGuestFollow(acme);
    removeGuestFollow("  ACME.COM  ");
    assert.deepEqual(listGuestFollows(), []);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";

import {
    claimSignupEvent,
    claimSignupOnProfile,
    isNewAccount,
    SIGNUP_CLAIM_FIELD,
    SIGNUP_FRESHNESS_MS,
    type SignupEventDeps,
} from "@/lib/auth/signup-event";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** In-memory stand-in for the `profiles` collection; transactions run serially, like Firestore's. */
function fakeDb(opts: { failWith?: Error } = {}) {
    const docs = new Map<string, Record<string, unknown>>();
    let queue: Promise<unknown> = Promise.resolve();
    const db = {
        collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
        runTransaction: (fn: (tx: unknown) => Promise<boolean>) => {
            const run = queue.then(() => {
                if (opts.failWith) throw opts.failWith;
                return fn({
                    get: async (path: string) => ({ get: (f: string) => docs.get(path)?.[f] }),
                    set: (path: string, data: Record<string, unknown>) => {
                        docs.set(path, { ...docs.get(path), ...data });
                    },
                });
            });
            queue = run.catch(() => undefined);
            return run;
        },
    } as unknown as Firestore;
    return { db, docs };
}

function depsOn(db: Firestore): SignupEventDeps {
    return { claim: (uid) => claimSignupOnProfile(db, uid), now: () => NOW };
}

const newUser = { id: "user_new", externalId: null, createdAt: iso(5_000) };

describe("isNewAccount — decided from the creation timestamp, not a later tag", () => {
    it("fresh inside the window, stale outside, unparseable is not new", () => {
        assert.equal(isNewAccount(iso(0), NOW), true);
        assert.equal(isNewAccount(iso(SIGNUP_FRESHNESS_MS), NOW), true);
        assert.equal(isNewAccount(iso(SIGNUP_FRESHNESS_MS + 1), NOW), false);
        assert.equal(isNewAccount("not-a-date", NOW), false);
    });
});

describe("claimSignupEvent — at most one signup_completed per user id, ever", () => {
    it("new user → exactly 1 event, and the claim is recorded on the profile", async () => {
        const { db, docs } = fakeDb();
        assert.equal(await claimSignupEvent(newUser, depsOn(db)), true);
        assert.ok(docs.get("profiles/user_new")?.[SIGNUP_CLAIM_FIELD]);
    });

    it("returning user (old createdAt) → 0, without touching the store", async () => {
        const { db, docs } = fakeDb();
        const returning = { id: "user_old", externalId: null, createdAt: iso(30 * 24 * 3_600_000) };
        assert.equal(await claimSignupEvent(returning, depsOn(db)), false);
        assert.equal(docs.size, 0);
    });

    it("legacy migrated user with no intervu tag (old createdAt) → 0 on every sign-in", async () => {
        const { db } = fakeDb();
        const legacy = { id: "user_legacy", externalId: "2qBRDOvdMKOMjN6y65EaSGEY28H3", createdAt: iso(40 * 24 * 3_600_000) };
        for (let i = 0; i < 5; i++) assert.equal(await claimSignupEvent(legacy, depsOn(db)), false);
    });

    it("callback retried or refreshed for the same fresh account → still 1", async () => {
        const { db } = fakeDb();
        const results = [];
        for (let i = 0; i < 4; i++) results.push(await claimSignupEvent(newUser, depsOn(db)));
        assert.deepEqual(results, [true, false, false, false]);
    });

    it("two concurrent callbacks (two tabs) → exactly 1", async () => {
        const { db } = fakeDb();
        const results = await Promise.all([1, 2, 3].map(() => claimSignupEvent(newUser, depsOn(db))));
        assert.equal(results.filter(Boolean).length, 1);
    });

    it("second provider linked to the same user → 0 (password signup claimed first)", async () => {
        const { db } = fakeDb();
        assert.equal(await claimSignupEvent(newUser, depsOn(db)), true); // signUp
        assert.equal(await claimSignupEvent(newUser, depsOn(db)), false); // later Google callback, same uid, still inside the window
    });

    it("keys the claim on externalId when present, so it matches the analytics distinct_id", async () => {
        const { db, docs } = fakeDb();
        await claimSignupEvent({ ...newUser, externalId: "ext_1" }, depsOn(db));
        assert.deepEqual([...docs.keys()], ["profiles/ext_1"]);
    });

    it("two different new users each get their own event", async () => {
        const { db } = fakeDb();
        assert.equal(await claimSignupEvent(newUser, depsOn(db)), true);
        assert.equal(await claimSignupEvent({ ...newUser, id: "user_other" }, depsOn(db)), true);
    });

    it("a store error declines (false), never fabricates a signup", async () => {
        const { db } = fakeDb({ failWith: new Error("firestore down") });
        const errors: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void errors.push(args);
        try {
            assert.equal(await claimSignupEvent(newUser, depsOn(db)), false);
        } finally {
            console.error = original;
        }
        assert.equal(errors.length, 1);
    });
});

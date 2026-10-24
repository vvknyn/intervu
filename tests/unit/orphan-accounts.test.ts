import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AGENT } from "../../src/lib/agent/config";
import { memoryStore } from "../../src/lib/agent/store";
import { issueCredential, revokeCredential } from "../../src/lib/agent/tokens";
import { deleteWorkosSignIn } from "../../src/lib/account/erase-deps";
import {
    assertAllOrphans,
    findOrphanUids,
    proveOrphan,
    revokeActiveCredentials,
    scanOrphans,
    uidLabel,
    type OrphanSources,
    type WorkosLookup,
} from "../../src/lib/account/orphan-accounts";
import { applyRefusal, parseEraseArgs } from "../../scripts/erase-orphan-accounts";
import { orphanScanResponse, POST } from "../../src/app/api/ops/orphan-accounts/route";

const notFound = () => Object.assign(new Error("not found"), { name: "NotFoundException", status: 404 });
const status = (code: number) => Object.assign(new Error("boom"), { status: code });
const ok = async () => ({ id: "user_1" });
const gone = async () => {
    throw notFound();
};
const lookup = (byId: WorkosLookup["getUser"], byExt: WorkosLookup["getUserByExternalId"]): WorkosLookup => ({ getUser: byId, getUserByExternalId: byExt });

const sources = (over: Partial<{ profiles: string[]; owners: string[]; known: string[] }> = {}): OrphanSources => ({
    profileUids: async () => over.profiles ?? [],
    credentialUids: async () => over.owners ?? [],
    workosIds: async () => new Set(over.known ?? []),
});

describe("proveOrphan", () => {
    it("is an orphan only when both lookups are 404", async () => {
        assert.equal(await proveOrphan(lookup(gone, gone), "u1"), true);
    });
    it("a 200 on either lookup is not an orphan", async () => {
        assert.equal(await proveOrphan(lookup(ok, gone), "u1"), false);
        assert.equal(await proveOrphan(lookup(gone, ok), "u1"), false);
    });
    it("any other status throws", async () => {
        await assert.rejects(proveOrphan(lookup(async () => Promise.reject(status(500)), gone), "u1"), /status 500/);
        await assert.rejects(proveOrphan(lookup(gone, async () => Promise.reject(status(429))), "u1"), /status 429/);
    });
});

describe("assertAllOrphans", () => {
    it("passes when every uid is proven", async () => {
        await assertAllOrphans(lookup(gone, gone), ["a", "b"]);
    });
    it("aborts the whole run on one live uid, naming only its label", async () => {
        const seen: string[] = [];
        const l = lookup(async (id) => (seen.push(id), id === "b-live" ? { id } : Promise.reject(notFound())), gone);
        await assert.rejects(assertAllOrphans(l, ["a", "b-live", "c"]), (e: Error) => e.message.includes(uidLabel("b-live")) && !e.message.includes("b-live"));
        assert.deepEqual(seen, ["a", "b-live"]);
    });
    it("refuses a uid that is not a plain id before any WorkOS call", async () => {
        let calls = 0;
        const counting = lookup(async () => (calls++, Promise.reject(notFound())), gone);
        for (const bad of ["../users", "a/b", "a b", "a?x=1", "", "x".repeat(129)]) {
            await assert.rejects(assertAllOrphans(counting, ["ok_1-A", bad]), /not a plain id/, bad);
        }
        assert.equal(calls, 6, "only the valid uid ever reached WorkOS");
    });
    it("aborts on a 500", async () => {
        await assert.rejects(assertAllOrphans(lookup(async () => Promise.reject(status(500)), gone), ["a"]), /aborting, no writes made/);
    });
});

describe("findOrphanUids", () => {
    it("reports profile uids with no WorkOS user by id or external_id", async () => {
        const out = await findOrphanUids(sources({ profiles: ["p1", "p2", "p3"], known: ["p1", "user_x"] }));
        assert.deepEqual(out, ["p2", "p3"]);
    });
    it("reports a credential-only uid (no profile) with no WorkOS user", async () => {
        assert.deepEqual(await findOrphanUids(sources({ profiles: ["p1"], owners: ["c1"], known: ["p1"] })), ["c1"]);
    });
    it("does not report a credential-only uid that has a WorkOS user by external_id", async () => {
        assert.deepEqual(await findOrphanUids(sources({ owners: ["c1"], known: ["c1", "user_9"] })), []);
    });
    it("throws instead of calling everyone an orphan when WorkOS lists nothing", async () => {
        await assert.rejects(findOrphanUids(sources({ profiles: ["p1"] })), /empty/);
        await assert.rejects(findOrphanUids(sources({ owners: ["c1"] })), /empty/);
    });
});

describe("revokeActiveCredentials / scanOrphans", () => {
    it("revokes only active credentials and counts the real number", async () => {
        const store = memoryStore();
        const a = await issueCredential(store, { uid: "c1", kind: "manual", ttlMs: null });
        await issueCredential(store, { uid: "c1", kind: "manual", ttlMs: null });
        await revokeCredential(store, "c1", a.credential.id);
        assert.equal(await revokeActiveCredentials(store, "c1"), 1);
        assert.equal(await revokeActiveCredentials(store, "c1"), 0);
    });
    it("counts orphans and those holding an active credential", async () => {
        const store = memoryStore();
        await issueCredential(store, { uid: "c1", kind: "manual", ttlMs: null });
        const dead = await issueCredential(store, { uid: "p2", kind: "manual", ttlMs: null });
        await revokeCredential(store, "p2", dead.credential.id);
        const report = await scanOrphans(sources({ profiles: ["p2", "p3"], owners: ["c1", "p2"], known: ["x"] }), store);
        assert.deepEqual(report, { profiles: 2, workosUsers: 1, orphans: 3, withActiveCredentials: 1 });
    });
    it("the store lists credentials by collection", async () => {
        const store = memoryStore();
        await issueCredential(store, { uid: "c1", kind: "manual" });
        assert.equal((await store.list(AGENT.collections.credentials)).length, 1);
    });
});

describe("deleteWorkosSignIn", () => {
    it("maps a WorkOS 404 to not-found, not a failure", async () => {
        const um = { getUserByExternalId: gone, deleteUser: async () => Promise.reject(notFound()) };
        assert.equal(await deleteWorkosSignIn(um as never, "u1"), "not-found");
    });
    it("reports deleted when the user exists", async () => {
        const um = { getUserByExternalId: async () => ({ id: "user_1" }), deleteUser: async () => undefined };
        assert.equal(await deleteWorkosSignIn(um as never, "u1"), "deleted");
    });
    it("rethrows any other error", async () => {
        const um = { getUserByExternalId: gone, deleteUser: async () => Promise.reject(status(500)) };
        await assert.rejects(deleteWorkosSignIn(um as never, "u1"));
    });
});

describe("orphan-accounts route", () => {
    const call = (auth?: string) =>
        POST(new Request("http://x/api/ops/orphan-accounts", { method: "POST", headers: auth ? { authorization: auth } : {} }));
    it("503 when the secret is unset, 401 on a wrong bearer", async () => {
        delete process.env.ORPHAN_ACCOUNTS_CRON_SECRET;
        assert.equal((await call("Bearer s")).status, 503);
        process.env.ORPHAN_ACCOUNTS_CRON_SECRET = "s3cret";
        assert.equal((await call()).status, 401);
        assert.equal((await call("Bearer nope")).status, 401);
    });
    it("answers the counts with 200", async () => {
        const res = await orphanScanResponse(async () => ({ profiles: 9, workosUsers: 8, orphans: 2, withActiveCredentials: 1 }));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { profiles: 9, workosUsers: 8, orphans: 2, withActiveCredentials: 1 });
    });
    it("a failed scan is a 500 and never a zero count", async () => {
        const res = await orphanScanResponse(async () => Promise.reject(new Error("workos down")));
        assert.equal(res.status, 500);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal("orphans" in body, false);
    });
});

describe("erase script guards", () => {
    it("--apply needs --uids and a positive --expect", () => {
        assert.ok("error" in parseEraseArgs(["--apply", "--uids=f"]));
        assert.ok("error" in parseEraseArgs(["--apply", "--uids=f", "--expect=0"]));
        assert.deepEqual(parseEraseArgs(["--apply", "--uids=f", "--expect=2"]), { apply: true, uidsFile: "f", expect: 2 });
    });
    it("refuses a count mismatch and an all-profiles orphan set; allows a proper subset", () => {
        assert.match(applyRefusal(["a", "b"], 3, 10) ?? "", /--expect=3/);
        assert.match(applyRefusal(["a", "b"], 2, 2) ?? "", /every profile/);
        assert.match(applyRefusal([], 1, 5) ?? "", /empty/);
        assert.equal(applyRefusal(["a", "b"], 2, 10), null);
    });
});

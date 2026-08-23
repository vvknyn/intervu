import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    listAppUsers,
    getAppUser,
    type DirectoryAdminClient,
    type DirectoryUser,
} from "@/lib/auth/user-directory";
import type { User as SupabaseUser } from "@supabase/supabase-js";

/** Minimal shape of what `listAppUsers`/`getAppUser` read off a Supabase
 *  auth user — enough fields to exercise app-tag filtering, legacyUid
 *  resolution and the display/email mapping. */
interface FakeUser {
    id: string;
    email?: string;
    email_confirmed_at?: string;
    created_at: string;
    last_sign_in_at?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
}

/** Hand-rolled fake satisfying DirectoryAdminClient — same pattern as
 *  ensure-app-membership.test.ts's fakeAdminClient (no node:test module
 *  mocking, no network). Paginates a fixed in-memory user list by
 *  `{page, perPage}`, tracking every `listUsers` call's params so
 *  pagination itself is assertable. */
function fakeAdminClient(users: FakeUser[]) {
    const listCalls: Array<{ page: number; perPage: number }> = [];
    const client: DirectoryAdminClient = {
        auth: {
            admin: {
                async listUsers({ page, perPage }) {
                    listCalls.push({ page, perPage });
                    const start = (page - 1) * perPage;
                    const slice = users.slice(start, start + perPage) as unknown as SupabaseUser[];
                    const hasMore = start + perPage < users.length;
                    return {
                        data: { users: slice, nextPage: hasMore ? page + 1 : null },
                        error: null,
                    };
                },
                async getUserById(id: string) {
                    const user = users.find((u) => u.id === id);
                    if (!user) return { data: { user: null }, error: { message: "not found" } };
                    return { data: { user: user as unknown as SupabaseUser }, error: null };
                },
            },
        },
    };
    return { client, get listCalls() { return listCalls; } };
}

function user(overrides: Partial<FakeUser> & { id: string }): FakeUser {
    return { created_at: "2026-01-01T00:00:00.000Z", ...overrides };
}

async function collect(iter: AsyncIterable<DirectoryUser>): Promise<DirectoryUser[]> {
    const out: DirectoryUser[] = [];
    for await (const u of iter) out.push(u);
    return out;
}

describe("listAppUsers — app-tag filtering", () => {
    it("returns only users tagged with the requested app", async () => {
        const fake = fakeAdminClient([
            user({ id: "u1", app_metadata: { apps: ["intervu"] } }),
            user({ id: "u2", app_metadata: { apps: ["subspace"] } }),
        ]);
        const result = await collect(listAppUsers("intervu", fake.client));
        assert.deepEqual(result.map((u) => u.id), ["u1"]);
    });

    it("excludes a user tagged with a different app", async () => {
        const fake = fakeAdminClient([user({ id: "u1", app_metadata: { apps: ["subspace"] } })]);
        const result = await collect(listAppUsers("intervu", fake.client));
        assert.deepEqual(result, []);
    });

    it("fails closed: an untagged user is excluded, never included by default", async () => {
        const fake = fakeAdminClient([
            user({ id: "u1" }),
            user({ id: "u2", app_metadata: {} }),
            user({ id: "u3", app_metadata: { apps: [] } }),
        ]);
        const result = await collect(listAppUsers("intervu", fake.client));
        assert.deepEqual(result, []);
    });

    it("a user tagged with both products appears for either slug", async () => {
        const fake = fakeAdminClient([user({ id: "u1", app_metadata: { apps: ["subspace", "intervu"] } })]);
        assert.deepEqual((await collect(listAppUsers("intervu", fake.client))).map((u) => u.id), ["u1"]);
        assert.deepEqual((await collect(listAppUsers("subspace", fake.client))).map((u) => u.id), ["u1"]);
    });

    it("is generic across app slugs — not special-cased to 'intervu'", async () => {
        const fake = fakeAdminClient([
            user({ id: "u1", app_metadata: { apps: ["subspace"] } }),
            user({ id: "u2", app_metadata: { apps: ["intervu"] } }),
        ]);
        const result = await collect(listAppUsers("subspace", fake.client));
        assert.deepEqual(result.map((u) => u.id), ["u1"]);
    });

    it("pagination: more users than one page yields all of them, once each", async () => {
        const many = Array.from({ length: 2500 }, (_, i) =>
            user({ id: `u${i}`, app_metadata: { apps: ["intervu"] } }),
        );
        const fake = fakeAdminClient(many);
        const result = await collect(listAppUsers("intervu", fake.client));
        assert.equal(result.length, 2500);
        const ids = result.map((u) => u.id);
        assert.equal(new Set(ids).size, 2500, "no duplicates");
        assert.deepEqual(ids, many.map((u) => u.id), "none dropped, none reordered");
        assert.equal(fake.listCalls.length, 3, "walked exactly 3 pages of 1000");
    });

    it("legacyUid resolves to firebase_uid when present, else the supabase id", async () => {
        const fake = fakeAdminClient([
            user({ id: "sb-1", app_metadata: { apps: ["intervu"], firebase_uid: "fb-abc123" } }),
            user({ id: "sb-2", app_metadata: { apps: ["intervu"] } }),
        ]);
        const result = await collect(listAppUsers("intervu", fake.client));
        const byId = new Map(result.map((u) => [u.id, u]));
        assert.equal(byId.get("sb-1")?.legacyUid, "fb-abc123");
        assert.equal(byId.get("sb-2")?.legacyUid, "sb-2");
    });

    it("maps email, verification, display name and timestamps", async () => {
        const fake = fakeAdminClient([
            user({
                id: "u1",
                email: "person@example.com",
                email_confirmed_at: "2026-02-01T00:00:00.000Z",
                created_at: "2026-01-01T00:00:00.000Z",
                last_sign_in_at: "2026-03-01T00:00:00.000Z",
                app_metadata: { apps: ["intervu"] },
                user_metadata: { full_name: "Ada Lovelace" },
            }),
        ]);
        const [result] = await collect(listAppUsers("intervu", fake.client));
        assert.equal(result.email, "person@example.com");
        assert.equal(result.emailVerified, true);
        assert.equal(result.displayName, "Ada Lovelace");
        assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
        assert.equal(result.lastSignInAt, "2026-03-01T00:00:00.000Z");
    });
});

describe("getAppUser — single-user lookup", () => {
    it("returns the user when found by id and tagged for the app", async () => {
        const fake = fakeAdminClient([user({ id: "u1", app_metadata: { apps: ["intervu"] } })]);
        const result = await getAppUser("u1", "intervu", fake.client);
        assert.equal(result?.id, "u1");
    });

    it("fails closed: found by id but tagged for a different app returns null", async () => {
        const fake = fakeAdminClient([user({ id: "u1", app_metadata: { apps: ["subspace"] } })]);
        const result = await getAppUser("u1", "intervu", fake.client);
        assert.equal(result, null);
    });

    it("falls back to a legacyUid scan when the id isn't the row's own primary key", async () => {
        const fake = fakeAdminClient([
            user({ id: "sb-1", app_metadata: { apps: ["intervu"], firebase_uid: "fb-legacy-1" } }),
        ]);
        const result = await getAppUser("fb-legacy-1", "intervu", fake.client);
        assert.equal(result?.id, "sb-1");
        assert.equal(result?.legacyUid, "fb-legacy-1");
    });

    it("returns null when no user matches by id or by legacyUid", async () => {
        const fake = fakeAdminClient([user({ id: "u1", app_metadata: { apps: ["intervu"] } })]);
        const result = await getAppUser("nonexistent", "intervu", fake.client);
        assert.equal(result, null);
    });

    it("is generic across app slugs in the legacyUid fallback path too", async () => {
        const fake = fakeAdminClient([
            user({ id: "sb-1", app_metadata: { apps: ["subspace"], firebase_uid: "fb-legacy-1" } }),
        ]);
        assert.equal(await getAppUser("fb-legacy-1", "intervu", fake.client), null);
        const result = await getAppUser("fb-legacy-1", "subspace", fake.client);
        assert.equal(result?.id, "sb-1");
    });
});

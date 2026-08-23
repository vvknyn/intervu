import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    GOOGLE_PROVIDER_ID,
    isInScope,
    planUserProvisioning,
    listAllFirebaseUsers,
    runProvisioning,
    type ExistingSupabaseUser,
    type FirebaseListUsersClient,
    type FirebaseSourceUser,
    type SupabaseAdminClient,
} from "@/lib/auth/provision-plan";
import type { User as SupabaseUser } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Fakes — hand-rolled, no network, same pattern as
// ensure-app-membership.test.ts / user-directory.test.ts.
// ---------------------------------------------------------------------------

interface FakeFirebaseUser {
    uid: string;
    email?: string;
    providerData: { providerId: string }[];
}

/** Paginates a fixed in-memory user list by (maxResults, pageToken), the
 *  same walking contract `listAllFirebaseUsers` drives. */
function fakeFirebaseClient(users: FakeFirebaseUser[]) {
    const listCalls: Array<{ maxResults?: number; pageToken?: string }> = [];
    const client: FirebaseListUsersClient = {
        async listUsers(maxResults, pageToken) {
            listCalls.push({ maxResults, pageToken });
            const start = pageToken ? Number(pageToken) : 0;
            const size = maxResults ?? users.length;
            const slice = users.slice(start, start + size);
            const nextStart = start + size;
            const hasMore = nextStart < users.length;
            return { users: slice, pageToken: hasMore ? String(nextStart) : undefined };
        },
    };
    return {
        client,
        get listCalls() {
            return listCalls;
        },
    };
}

interface FakeSupabaseUser {
    id: string;
    email?: string;
    email_confirmed_at?: string;
    app_metadata?: Record<string, unknown>;
}

/** Paginates an in-memory `auth.users` table AND tracks create/update calls,
 *  so a test can assert both what was written and, just as importantly,
 *  that nothing was written at all. */
function fakeSupabaseClient(initialUsers: FakeSupabaseUser[]) {
    const users = [...initialUsers];
    let nextId = 0;
    const listUsersCalls: Array<{ page: number; perPage: number }> = [];
    const createUserCalls: Array<{ email: string; email_confirm: boolean; app_metadata: Record<string, unknown> }> = [];
    const updateUserByIdCalls: Array<{ id: string; app_metadata: Record<string, unknown> }> = [];

    const client: SupabaseAdminClient = {
        auth: {
            admin: {
                async listUsers({ page, perPage }) {
                    listUsersCalls.push({ page, perPage });
                    const start = (page - 1) * perPage;
                    const slice = users.slice(start, start + perPage) as unknown as SupabaseUser[];
                    const hasMore = start + perPage < users.length;
                    return { data: { users: slice, nextPage: hasMore ? page + 1 : null }, error: null };
                },
                async getUserById(id: string) {
                    const found = users.find((u) => u.id === id);
                    if (!found) return { data: { user: null }, error: { message: "not found" } };
                    return { data: { user: found as unknown as SupabaseUser }, error: null };
                },
                async createUser(attrs) {
                    createUserCalls.push(attrs);
                    const created: FakeSupabaseUser = {
                        id: `created-${nextId++}`,
                        email: attrs.email,
                        email_confirmed_at: attrs.email_confirm ? "2026-01-01T00:00:00.000Z" : undefined,
                        app_metadata: attrs.app_metadata,
                    };
                    users.push(created);
                    return { data: { user: created as unknown as SupabaseUser }, error: null };
                },
                async updateUserById(id, attrs) {
                    updateUserByIdCalls.push({ id, app_metadata: attrs.app_metadata });
                    const found = users.find((u) => u.id === id);
                    if (!found) return { data: { user: null }, error: { message: "not found" } };
                    found.app_metadata = attrs.app_metadata;
                    return { data: { user: found as unknown as SupabaseUser }, error: null };
                },
            },
        },
    };

    return {
        client,
        get listUsersCalls() {
            return listUsersCalls;
        },
        get createUserCalls() {
            return createUserCalls;
        },
        get updateUserByIdCalls() {
            return updateUserByIdCalls;
        },
    };
}

function fbUser(overrides: Partial<FirebaseSourceUser> & { uid: string }): FirebaseSourceUser {
    return { email: `${overrides.uid}@example.com`, providers: [GOOGLE_PROVIDER_ID], ...overrides };
}

// ---------------------------------------------------------------------------
// isInScope — pure
// ---------------------------------------------------------------------------

describe("isInScope — pure scope filter", () => {
    it("a Google SSO user is always in scope", () => {
        assert.equal(isInScope(["google.com"], false), true);
        assert.equal(isInScope(["google.com"], true), true);
    });

    it("a password-only user is excluded by default, included with the flag", () => {
        assert.equal(isInScope(["password"], false), false);
        assert.equal(isInScope(["password"], true), true);
    });

    it("a user linked to both providers is in scope regardless of the flag", () => {
        assert.equal(isInScope(["password", "google.com"], false), true);
    });
});

// ---------------------------------------------------------------------------
// planUserProvisioning — pure decision
// ---------------------------------------------------------------------------

describe("planUserProvisioning — pure decision", () => {
    it("absent from Supabase -> CREATE with email_confirm semantics and correct app_metadata", () => {
        const entry = planUserProvisioning(fbUser({ uid: "fb-1", email: "a@example.com" }), null, "intervu");
        assert.equal(entry.action, "CREATE");
        assert.deepEqual(entry, {
            action: "CREATE",
            firebaseUid: "fb-1",
            email: "a@example.com",
            reason: entry.reason,
            appMetadata: { apps: ["intervu"], firebase_uid: "fb-1" },
        });
    });

    it("already provisioned (apps already contains the slug) -> SKIP", () => {
        const existing: ExistingSupabaseUser = {
            id: "sb-1",
            email: "a@example.com",
            emailConfirmed: true,
            app_metadata: { apps: ["intervu"] },
        };
        const entry = planUserProvisioning(fbUser({ uid: "fb-1", email: "a@example.com" }), existing, "intervu");
        assert.equal(entry.action, "SKIP_ALREADY_PROVISIONED");
    });

    it("exists under the other product with a CONFIRMED email -> APPEND_APP, preserving every other key", () => {
        const existing: ExistingSupabaseUser = {
            id: "sb-1",
            email: "a@example.com",
            emailConfirmed: true,
            app_metadata: { apps: ["subspace"], firebase_uid: "fb-other-legacy", providers: ["email"], custom: "keep-me" },
        };
        const entry = planUserProvisioning(fbUser({ uid: "fb-1", email: "a@example.com" }), existing, "intervu");
        assert.equal(entry.action, "APPEND_APP");
        assert.deepEqual(entry.action === "APPEND_APP" ? entry.appMetadata : null, {
            apps: ["subspace", "intervu"],
            firebase_uid: "fb-other-legacy",
            providers: ["email"],
            custom: "keep-me",
        });
    });

    it("exists under the other product with an UNCONFIRMED email -> CONFLICT, not APPEND", () => {
        const existing: ExistingSupabaseUser = {
            id: "sb-1",
            email: "a@example.com",
            emailConfirmed: false,
            app_metadata: { apps: ["subspace"] },
        };
        const entry = planUserProvisioning(fbUser({ uid: "fb-1", email: "a@example.com" }), existing, "intervu");
        assert.equal(entry.action, "CONFLICT_UNCONFIRMED_EMAIL");
    });

    it("is generic — the same four branches hold for a slug other than 'intervu'", () => {
        assert.equal(planUserProvisioning(fbUser({ uid: "fb-1" }), null, "widgetco").action, "CREATE");
        const confirmed: ExistingSupabaseUser = {
            id: "sb-1",
            email: "a@example.com",
            emailConfirmed: true,
            app_metadata: { apps: ["intervu"] },
        };
        const entry = planUserProvisioning(fbUser({ uid: "fb-1", email: "a@example.com" }), confirmed, "widgetco");
        assert.equal(entry.action, "APPEND_APP");
        assert.deepEqual(entry.action === "APPEND_APP" ? entry.appMetadata.apps : null, ["intervu", "widgetco"]);
    });
});

// ---------------------------------------------------------------------------
// listAllFirebaseUsers — pagination
// ---------------------------------------------------------------------------

describe("listAllFirebaseUsers — pagination", () => {
    it("more users than one page are all processed, exactly once", async () => {
        const many = Array.from({ length: 2500 }, (_, i) => ({
            uid: `fb-${i}`,
            email: `fb-${i}@example.com`,
            providerData: [{ providerId: GOOGLE_PROVIDER_ID }],
        }));
        const fake = fakeFirebaseClient(many);
        const result = await listAllFirebaseUsers(fake.client);
        assert.equal(result.length, 2500);
        assert.equal(new Set(result.map((u) => u.uid)).size, 2500, "no duplicates");
        assert.equal(fake.listCalls.length, 3, "walked exactly 3 pages of 1000");
    });

    it("drops users with no email — nothing to match or create against", async () => {
        const fake = fakeFirebaseClient([
            { uid: "fb-1", email: "a@example.com", providerData: [] },
            { uid: "fb-2", providerData: [] },
        ]);
        const result = await listAllFirebaseUsers(fake.client);
        assert.deepEqual(result.map((u) => u.uid), ["fb-1"]);
    });
});

// ---------------------------------------------------------------------------
// runProvisioning — full I/O wrapper (dry-run + apply)
// ---------------------------------------------------------------------------

describe("runProvisioning — dry run makes zero writes", () => {
    it("performs ZERO writes even when there is CREATE and APPEND_APP work to do", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-new", email: "new@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
            { uid: "fb-merge", email: "merge@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([
            {
                id: "sb-existing",
                email: "merge@example.com",
                email_confirmed_at: "2026-01-01T00:00:00.000Z",
                app_metadata: { apps: ["subspace"] },
            },
        ]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: false,
        });

        assert.equal(sb.createUserCalls.length, 0, "dry run must not call createUser");
        assert.equal(sb.updateUserByIdCalls.length, 0, "dry run must not call updateUserById");
        assert.equal(result.created, 0);
        assert.equal(result.appended, 0);
        assert.equal(result.rows.find((r) => r.entry.firebaseUid === "fb-new")?.entry.action, "CREATE");
        assert.equal(result.rows.find((r) => r.entry.firebaseUid === "fb-merge")?.entry.action, "APPEND_APP");
    });
});

describe("runProvisioning — apply mode", () => {
    it("CREATE: writes email_confirm true and the correct app_metadata, no password", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-new", email: "new@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: true,
        });

        assert.equal(result.created, 1);
        assert.equal(result.failed, 0);
        assert.equal(sb.createUserCalls.length, 1);
        const call = sb.createUserCalls[0];
        assert.equal(call.email, "new@example.com");
        assert.equal(call.email_confirm, true);
        assert.deepEqual(call.app_metadata, { apps: ["intervu"], firebase_uid: "fb-new" });
        assert.equal("password" in call, false, "must never pass a password");
    });

    it("already provisioned -> SKIP, and asserts no write of any kind was attempted", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-1", email: "a@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([
            { id: "sb-1", email: "a@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z", app_metadata: { apps: ["intervu"] } },
        ]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: true,
        });

        assert.equal(result.skipped, 1);
        assert.equal(sb.createUserCalls.length, 0);
        assert.equal(sb.updateUserByIdCalls.length, 0);
    });

    it("other product, CONFIRMED email -> apps becomes [other, intervu], every other key survives", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-1", email: "a@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([
            {
                id: "sb-1",
                email: "a@example.com",
                email_confirmed_at: "2026-01-01T00:00:00.000Z",
                app_metadata: { apps: ["subspace"], firebase_uid: "fb-other-legacy", providers: ["email"], custom: "keep-me" },
            },
        ]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: true,
        });

        assert.equal(result.appended, 1);
        assert.equal(sb.createUserCalls.length, 0, "must never create a new row for an existing account");
        assert.equal(sb.updateUserByIdCalls.length, 1);
        assert.deepEqual(sb.updateUserByIdCalls[0].app_metadata, {
            apps: ["subspace", "intervu"],
            firebase_uid: "fb-other-legacy",
            providers: ["email"],
            custom: "keep-me",
        });
    });

    it("other product, UNCONFIRMED email -> CONFLICT, no write attempted", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-1", email: "a@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([
            { id: "sb-1", email: "a@example.com", app_metadata: { apps: ["subspace"] } }, // no email_confirmed_at
        ]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: true,
        });

        assert.equal(result.conflicts, 1);
        assert.equal(result.failed, 0);
        assert.equal(sb.createUserCalls.length, 0);
        assert.equal(sb.updateUserByIdCalls.length, 0);
    });

    it("a password-only user is excluded by default and included with the flag, created with no password", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-pw", email: "pw@example.com", providerData: [{ providerId: "password" }] },
        ]);

        const excluded = await runProvisioning(fbClient.client, fakeSupabaseClient([]).client, {
            app: "intervu",
            includePasswordUsers: false,
            apply: true,
        });
        assert.equal(excluded.outOfScopeCount, 1);
        assert.equal(excluded.rows.length, 0);

        const sb = fakeSupabaseClient([]);
        const included = await runProvisioning(fbClient.client, sb.client, {
            app: "intervu",
            includePasswordUsers: true,
            apply: true,
        });
        assert.equal(included.created, 1);
        assert.equal("password" in sb.createUserCalls[0], false);
    });

    it("is generic end to end — a slug other than 'intervu' works the same way", async () => {
        const fbClient = fakeFirebaseClient([
            { uid: "fb-1", email: "new@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
            { uid: "fb-2", email: "merge@example.com", providerData: [{ providerId: GOOGLE_PROVIDER_ID }] },
        ]);
        const sb = fakeSupabaseClient([
            {
                id: "sb-2",
                email: "merge@example.com",
                email_confirmed_at: "2026-01-01T00:00:00.000Z",
                app_metadata: { apps: ["intervu"] },
            },
        ]);

        const result = await runProvisioning(fbClient.client, sb.client, {
            app: "widgetco",
            includePasswordUsers: false,
            apply: true,
        });

        assert.equal(result.created, 1);
        assert.deepEqual(sb.createUserCalls[0].app_metadata, { apps: ["widgetco"], firebase_uid: "fb-1" });
        assert.equal(result.appended, 1);
        assert.deepEqual(sb.updateUserByIdCalls[0].app_metadata, { apps: ["intervu", "widgetco"] });
    });
});

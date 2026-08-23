import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    ensureAppMembership,
    computeAppMembershipUpdate,
    type AdminAuthClient,
} from "@/lib/auth/ensure-app-membership";

/** Hand-rolled fake satisfying AdminAuthClient, tracking calls without
 *  node:test's experimental module mocking (unavailable in this env). */
function fakeAdminClient(initialAppMetadata: unknown) {
    let stored: unknown = initialAppMetadata;
    let updateCalls = 0;
    let lastUpdateArgs: { id: string; app_metadata: Record<string, unknown> } | null = null;

    const client: AdminAuthClient = {
        auth: {
            admin: {
                async getUserById(id: string) {
                    return { data: { user: { app_metadata: stored } }, error: null };
                },
                async updateUserById(id: string, attrs: { app_metadata: Record<string, unknown> }) {
                    updateCalls++;
                    lastUpdateArgs = { id, app_metadata: attrs.app_metadata };
                    stored = attrs.app_metadata;
                    return { error: null };
                },
            },
        },
    };

    return {
        client,
        get updateCalls() {
            return updateCalls;
        },
        get lastUpdateArgs() {
            return lastUpdateArgs;
        },
        get stored() {
            return stored;
        },
    };
}

describe("computeAppMembershipUpdate — pure decision", () => {
    it("absent tag: creates a fresh apps array", () => {
        const result = computeAppMembershipUpdate(undefined, "intervu");
        assert.equal(result.added, true);
        assert.deepEqual(result.appMetadata, { apps: ["intervu"] });
    });

    it("existing other-app tag: appends, never overwrites", () => {
        const result = computeAppMembershipUpdate({ apps: ["subspace"] }, "intervu");
        assert.equal(result.added, true);
        assert.deepEqual(result.appMetadata, { apps: ["subspace", "intervu"] });
    });

    it("already tagged: no-op, returns the original metadata untouched", () => {
        const original = { apps: ["intervu"], other_field: "keep-me" };
        const result = computeAppMembershipUpdate(original, "intervu");
        assert.equal(result.added, false);
        assert.deepEqual(result.appMetadata, original);
    });

    it("generic across slugs: 'subspace' is not special-cased to 'intervu'", () => {
        const result = computeAppMembershipUpdate({ apps: ["intervu"] }, "subspace");
        assert.equal(result.added, true);
        assert.deepEqual(result.appMetadata, { apps: ["intervu", "subspace"] });
    });
});

describe("ensureAppMembership — I/O wrapper", () => {
    it("absent tag: writes a fresh ['intervu'] array", async () => {
        const fake = fakeAdminClient(undefined);
        const result = await ensureAppMembership("user-1", "intervu", fake.client);
        assert.equal(result.added, true);
        assert.equal(fake.updateCalls, 1);
        assert.deepEqual(fake.lastUpdateArgs?.app_metadata, { apps: ["intervu"] });
    });

    it("existing ['subspace']: becomes ['subspace','intervu']", async () => {
        const fake = fakeAdminClient({ apps: ["subspace"] });
        const result = await ensureAppMembership("user-2", "intervu", fake.client);
        assert.equal(result.added, true);
        assert.equal(fake.updateCalls, 1);
        assert.deepEqual(fake.lastUpdateArgs?.app_metadata, { apps: ["subspace", "intervu"] });
    });

    it("already tagged: makes no write at all (idempotent)", async () => {
        const fake = fakeAdminClient({ apps: ["intervu"] });
        const result = await ensureAppMembership("user-3", "intervu", fake.client);
        assert.equal(result.added, false);
        assert.equal(fake.updateCalls, 0);
    });

    it("generic across slugs: tags a non-intervu app the same way", async () => {
        const fake = fakeAdminClient(undefined);
        const result = await ensureAppMembership("user-4", "subspace", fake.client);
        assert.equal(result.added, true);
        assert.equal(fake.updateCalls, 1);
        assert.deepEqual(fake.lastUpdateArgs?.app_metadata, { apps: ["subspace"] });
    });

    it("propagates a lookup failure instead of silently treating it as untagged", async () => {
        const client: AdminAuthClient = {
            auth: {
                admin: {
                    async getUserById() {
                        return { data: { user: null }, error: { message: "user not found" } };
                    },
                    async updateUserById() {
                        throw new Error("must not be called");
                    },
                },
            },
        };
        await assert.rejects(() => ensureAppMembership("missing-user", "intervu", client));
    });
});

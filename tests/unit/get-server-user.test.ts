import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mapSupabaseUserToServerUser } from "@/lib/auth/session";
import type { User as SupabaseUser } from "@supabase/supabase-js";

function fakeUser(overrides: Partial<SupabaseUser>): SupabaseUser {
    return {
        id: "supabase-uuid-1",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    } as SupabaseUser;
}

describe("mapSupabaseUserToServerUser — the getServerUser field mapping", () => {
    it("migrated user (firebase_uid present): uid resolves to the FIREBASE uid, not the Supabase id", () => {
        const user = fakeUser({
            id: "supabase-uuid-migrated",
            email: "migrated@example.com",
            app_metadata: { firebase_uid: "firebase-legacy-uid-123", apps: ["intervu"] },
        });

        const result = mapSupabaseUserToServerUser(user);

        assert.equal(result?.uid, "firebase-legacy-uid-123");
        assert.notEqual(result?.uid, user.id);
        assert.equal(result?.email, "migrated@example.com");
    });

    it("new user (no firebase_uid): uid resolves to the Supabase id", () => {
        const user = fakeUser({
            id: "supabase-uuid-new",
            email: "new@example.com",
            app_metadata: { apps: ["intervu"] },
        });

        const result = mapSupabaseUserToServerUser(user);

        assert.equal(result?.uid, "supabase-uuid-new");
    });

    it("no session (null user): returns null — the shape every call site branches on", () => {
        assert.equal(mapSupabaseUserToServerUser(null), null);
        assert.equal(mapSupabaseUserToServerUser(undefined), null);
    });

    it("displayName prefers user_metadata.full_name, falls back to .name, else undefined", () => {
        assert.equal(
            mapSupabaseUserToServerUser(fakeUser({ user_metadata: { full_name: "Ada Lovelace", name: "Ada" } }))
                ?.displayName,
            "Ada Lovelace",
        );
        assert.equal(
            mapSupabaseUserToServerUser(fakeUser({ user_metadata: { name: "Ada" } }))?.displayName,
            "Ada",
        );
        assert.equal(mapSupabaseUserToServerUser(fakeUser({ user_metadata: {} }))?.displayName, undefined);
    });

    it("customClaims carries app_metadata through unchanged", () => {
        const appMetadata = { apps: ["intervu"], firebase_uid: "abc" };
        const result = mapSupabaseUserToServerUser(fakeUser({ app_metadata: appMetadata }));
        assert.deepEqual(result?.customClaims, appMetadata);
    });
});

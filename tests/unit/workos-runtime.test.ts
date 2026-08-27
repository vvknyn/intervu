import { test } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@workos-inc/node";
import {
  listIntervuUsers,
  resolveWorkosUserId,
  type WorkosUserManagement,
} from "../../src/lib/auth/workos-runtime";

/** Minimal `User` stand-in — only the fields `listIntervuUsers`/tests below touch. */
function fakeUser(id: string, apps: string | undefined): User {
  return { id, metadata: apps === undefined ? {} : { apps } } as User;
}

/** A `Pick<WorkosUserManagement, "listUsers">` fake shaped like the SDK's
 *  `AutoPaginatable` — just enough surface for `listIntervuUsers` to call.
 *  `AutoPaginatable` is a real SDK class with private internals, so the fake
 *  is cast rather than structurally matched. */
function fakeUserManagement(users: User[]): Pick<WorkosUserManagement, "listUsers"> {
  return {
    async listUsers() {
      return { autoPagination: async () => users } as unknown as Awaited<
        ReturnType<WorkosUserManagement["listUsers"]>
      >;
    },
  };
}

test("listIntervuUsers keeps only users tagged for this product", async () => {
  const users = [
    fakeUser("1", "intervu"),
    fakeUser("2", "subspace"),
    fakeUser("3", "intervu,subspace"),
    fakeUser("4", undefined),
  ];
  const kept = await listIntervuUsers(fakeUserManagement(users));
  assert.deepEqual(
    kept.map((u) => u.id),
    ["1", "3"],
  );
});

test("listIntervuUsers returns nothing when no user carries the tag", async () => {
  const users = [fakeUser("1", "subspace"), fakeUser("2", undefined)];
  const kept = await listIntervuUsers(fakeUserManagement(users));
  assert.deepEqual(kept, []);
});

test("resolveWorkosUserId prefers the WorkOS id behind a matching external id", async () => {
  const id = await resolveWorkosUserId(
    async (externalId) => ({ id: `workos-${externalId}` }) as User,
    "firebase-uid-1",
  );
  assert.equal(id, "workos-firebase-uid-1");
});

test("resolveWorkosUserId falls back to the raw uid when no external-id match exists", async () => {
  // `getUserByExternalId` rejects (NotFoundException) rather than returning
  // null — this is the case where `uid` is already a native WorkOS id.
  const id = await resolveWorkosUserId(async () => {
    throw new Error("NotFoundException");
  }, "already-a-workos-id");
  assert.equal(id, "already-a-workos-id");
});

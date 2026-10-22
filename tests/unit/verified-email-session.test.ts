import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@workos-inc/node";
import { signInVerifiedEmail } from "../../src/lib/auth/verified-email-session";

process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";

const user = (id: string, email: string) => ({ id, email }) as unknown as User;

function fakeDeps(over: Partial<Parameters<typeof signInVerifiedEmail>[0]> = {}) {
  const calls: string[] = [];
  const deps = {
    findUserByEmail: async (e: string) => { calls.push(`find:${e}`); return null; },
    createUser: async (o: { email: string; metadata: Record<string, string> }) => {
      calls.push(`create:${o.email}:${o.metadata.username}`);
      return user("u-new", o.email);
    },
    deleteUser: async (id: string) => { calls.push(`delete:${id}`); },
    createProfile: async (id: string, name: string) => { calls.push(`profile:${id}:${name}`); },
    isUsernameTaken: async () => false,
    createMagicAuth: async ({ email }: { email: string }) => { calls.push(`magic:${email}`); return { code: "123456" }; },
    authenticateWithMagicAuth: async (o: { code: string; email: string }) => {
      calls.push(`auth:${o.email}`);
      return { user: user("u-auth", o.email) } as never;
    },
    saveSession: async () => { calls.push("save"); },
    ...over,
  };
  return { deps, calls };
}

describe("signInVerifiedEmail", () => {
  it("new email: creates a verified passwordless account + profile, then signs in", async () => {
    const { deps, calls } = fakeDeps();
    const result = await signInVerifiedEmail(deps, "new@example.com");
    assert.equal(result?.id, "u-auth");
    assert.deepEqual(calls, [
      "find:new@example.com",
      "create:new@example.com:new",
      "profile:u-new:new",
      "magic:new@example.com",
      "auth:new@example.com",
      "save",
    ]);
  });

  it("existing account: no create, no profile, still signed in (no duplicate)", async () => {
    const { deps, calls } = fakeDeps({ findUserByEmail: async () => user("u-old", "old@example.com") });
    const result = await signInVerifiedEmail(deps, "old@example.com");
    assert.equal(result?.id, "u-auth");
    assert.equal(calls.some((c) => c.startsWith("create:") || c.startsWith("profile:")), false);
    assert.equal(calls.includes("save"), true);
  });

  it("taken username: derives the deriveUsername suffix form", async () => {
    let n = 0;
    const { deps, calls } = fakeDeps({ isUsernameTaken: async () => n++ === 0 });
    await signInVerifiedEmail(deps, "sam@example.com");
    const created = calls.find((c) => c.startsWith("create:"))!;
    assert.match(created, /^create:sam@example\.com:sam2$/);
  });

  it("profile failure rolls the new user back and returns null without a session", async () => {
    const { deps, calls } = fakeDeps({ createProfile: async () => { throw new Error("firestore down"); } });
    assert.equal(await signInVerifiedEmail(deps, "x@example.com"), null);
    assert.equal(calls.includes("delete:u-new"), true);
    assert.equal(calls.includes("save"), false);
  });

  it("sign-in failure returns null (never a fabricated user)", async () => {
    const { deps } = fakeDeps({ authenticateWithMagicAuth: async () => { throw new Error("nope"); } });
    assert.equal(await signInVerifiedEmail(deps, "x@example.com"), null);
  });
});

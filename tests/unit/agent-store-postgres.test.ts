import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { postgresStore, getAgentStore } from "../../src/lib/agent/store";
import { AGENT } from "../../src/lib/agent/config";

/** Column -> doc-field map for intervu.agent_credentials, mirroring
 *  MIGRATION_MANIFEST's `indexed` list (firestore-migration-manifest.ts) —
 *  the fake needs this to resolve which generated column an indexed WHERE
 *  clause reads, the same mapping columnNameFor()/postgresStore() compute
 *  from the manifest at runtime. */
const CREDENTIALS_COLUMN_TO_FIELD: Record<string, string> = {
  token_hash: "tokenHash",
  uid: "uid",
  client_id: "clientId",
  expires_at_ms: "expiresAt",
  revoked_at_ms: "revokedAt",
};

/** Minimal in-memory stand-in for `intervu.agent_credentials`, keyed on the
 *  same path(PK)/doc(jsonb) shape postgresStore() writes and dispatching on
 *  each method's distinct query shape — good enough to exercise the real
 *  read-decide-write cycle (including claim()'s atomic race guard) without a
 *  live Postgres connection, same convention
 *  tests/unit/company-read-budget.test.ts's fakePg() uses for a different
 *  table (no PG-backed fixture exists in this repo for either seam). */
function fakePg(): Queryable & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async query<R>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      if (text.startsWith("SELECT doc FROM")) {
        const [path] = params as [string];
        const doc = rows.get(path);
        return { rows: (doc ? [{ doc }] : []) as R[] };
      }
      if (text.startsWith("INSERT INTO")) {
        const [path, docJson] = params as [string, string];
        rows.set(path, JSON.parse(docJson));
        return { rows: [] as R[] };
      }
      if (text.includes("RETURNING doc")) {
        // claim(): UPDATE ... WHERE path = $1 AND doc->>$3 IS NULL
        const [path, patchJson, field] = params as [string, string, string];
        const existing = rows.get(path);
        if (!existing || existing[field] != null) return { rows: [] as R[] };
        const merged = { ...existing, ...JSON.parse(patchJson) };
        rows.set(path, merged);
        return { rows: [{ doc: merged }] as R[] };
      }
      if (text.includes("RETURNING path")) {
        // update(): UPDATE ... SET doc = doc || $2 WHERE path = $1
        const [path, patchJson] = params as [string, string];
        const existing = rows.get(path);
        if (!existing) return { rows: [] as R[] };
        rows.set(path, { ...existing, ...JSON.parse(patchJson) });
        return { rows: [{ path }] as R[] };
      }
      if (text.startsWith("DELETE FROM")) {
        const [path] = params as [string];
        rows.delete(path);
        return { rows: [] as R[] };
      }
      if (text.startsWith("SELECT path, doc FROM")) {
        const indexedMatch = text.match(/WHERE "(\w+)" = \$1/);
        const results: Array<{ path: string; doc: Record<string, unknown> }> = [];
        if (indexedMatch) {
          const field = CREDENTIALS_COLUMN_TO_FIELD[indexedMatch[1]];
          const [value] = params as [unknown];
          for (const [path, doc] of rows) if (doc[field] === value) results.push({ path, doc });
        } else {
          const [value, field] = params as [unknown, string];
          for (const [path, doc] of rows) if (doc[field] === value) results.push({ path, doc });
        }
        return { rows: results as R[] };
      }
      throw new Error(`fakePg: unrecognized query shape: ${text}`);
    },
  };
}

const COL = AGENT.collections.credentials; // "agent_credentials"

describe("postgresStore — get/set round trip", () => {
  it("returns null for a missing doc, then the exact doc after set()", async () => {
    const store = postgresStore(fakePg());
    assert.equal(await store.get(COL, "c1"), null);
    await store.set(COL, "c1", { uid: "u1", tokenHash: "h1", revokedAt: null });
    assert.deepEqual(await store.get(COL, "c1"), { uid: "u1", tokenHash: "h1", revokedAt: null });
  });

  it("set() upserts — a second set() on the same id overwrites rather than erroring", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1" });
    await store.set(COL, "c1", { uid: "u2" });
    assert.deepEqual(await store.get(COL, "c1"), { uid: "u2" });
  });
});

describe("postgresStore — update", () => {
  it("merges a partial patch onto the existing doc, leaving untouched fields alone", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1", lastUsedAt: null, revokedAt: null });
    await store.update(COL, "c1", { lastUsedAt: 1000 });
    assert.deepEqual(await store.get(COL, "c1"), { uid: "u1", lastUsedAt: 1000, revokedAt: null });
  });

  it("throws NOT_FOUND rather than silently no-opping when the doc does not exist", async () => {
    const store = postgresStore(fakePg());
    await assert.rejects(() => store.update(COL, "missing", { uid: "u1" }), /NOT_FOUND/);
  });
});

describe("postgresStore — remove", () => {
  it("deletes the row; a subsequent get() returns null", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1" });
    await store.remove(COL, "c1");
    assert.equal(await store.get(COL, "c1"), null);
  });
});

describe("postgresStore — findByField", () => {
  it("resolves an indexed field (tokenHash) via its generated column, not a doc->> scan", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1", tokenHash: "hash-a" });
    await store.set(COL, "c2", { uid: "u2", tokenHash: "hash-b" });
    const rows = await store.findByField(COL, "tokenHash", "hash-a");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "c1");
    assert.equal(rows[0].uid, "u1");
  });

  it("resolves a SECOND indexed field (uid) — not hardcoded to tokenHash — and can return multiple rows", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "shared", tokenHash: "hash-a" });
    await store.set(COL, "c2", { uid: "shared", tokenHash: "hash-b" });
    await store.set(COL, "c3", { uid: "other", tokenHash: "hash-c" });
    const rows = await store.findByField(COL, "uid", "shared");
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["c1", "c2"]
    );
  });
});

describe("postgresStore — claim (atomic single-use)", () => {
  it("succeeds once: stamps the field and returns the PRE-claim doc (field still null)", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1", revokedAt: null });
    const pre = await store.claim(COL, "c1", "revokedAt");
    assert.equal(pre?.uid, "u1");
    assert.equal(pre?.revokedAt, null, "returned doc reflects PRE-claim state");
    const stored = await store.get(COL, "c1");
    assert.notEqual(stored?.revokedAt, null, "the STORED doc now carries the stamp");
  });

  it("a second claim on the same id fails closed — the exact race this method exists to prevent", async () => {
    const store = postgresStore(fakePg());
    await store.set(COL, "c1", { uid: "u1", revokedAt: null });
    assert.notEqual(await store.claim(COL, "c1", "revokedAt"), null);
    assert.equal(await store.claim(COL, "c1", "revokedAt"), null);
  });

  it("claiming a missing id returns null rather than throwing", async () => {
    const store = postgresStore(fakePg());
    assert.equal(await store.claim(COL, "nope", "revokedAt"), null);
  });
});

describe("getAgentStore — routing chokepoint", () => {
  it("routes to Firestore semantics when AGENT_PG_LIVE_COLLECTIONS is unset — never touches AGENT_PG_URL", () => {
    delete process.env.AGENT_PG_LIVE_COLLECTIONS;
    // No throw, no attempt to read AGENT_PG_URL: constructing the store must
    // not eagerly resolve a pg pool for a collection nothing has declared live.
    assert.doesNotThrow(() => getAgentStore());
  });

  it("throws loudly — never a silent Firestore fallback — when a collection is declared live but AGENT_PG_URL is unset", async () => {
    delete process.env.AGENT_PG_URL;
    process.env.AGENT_PG_LIVE_COLLECTIONS = COL;
    const store = getAgentStore();
    await assert.rejects(() => store.get(COL, "c1"), /AGENT_PG_URL/);
    delete process.env.AGENT_PG_LIVE_COLLECTIONS;
  });
});

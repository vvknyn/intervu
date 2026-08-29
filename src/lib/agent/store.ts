/**
 * Storage seam for the agent/MCP feature.
 *
 * `memoryStore` is a Map-backed test double used by every later task's unit
 * tests. `firestoreStore` is the ORIGINAL production implementation.
 * `postgresStore` is the box-Postgres implementation (2026-08-29 — Vivek:
 * "why are the mcp tokens still on the firestore...move them to...
 * contabo"; tokens are opaque hashed secrets looked up by value, not
 * issuer-bound JWTs, so moving their storage backend costs zero re-auth —
 * see AGENT.issuer()'s doc comment). `getAgentStore()` is the one chokepoint
 * that decides which backend a given collection uses; every route/action
 * that used to call `firestoreStore()` directly now calls `getAgentStore()`
 * instead, so cutting a collection over is a single env-var flip, not an
 * N-call-site edit. Nothing from `firebase-admin` or `pg` is imported at
 * module top-level — both are lazily reached (dynamic import for Firestore,
 * a caller-supplied `Queryable` for Postgres) so importing this file (or
 * calling `memoryStore()`) never touches either backend's credentials.
 */
import type { Queryable } from "../pg/pool";
import { getAgentPg } from "../pg/pool";
import { MIGRATION_MANIFEST, INTERVU_SCHEMA, columnNameFor, type CollectionSpec } from "../db/firestore-migration-manifest";

export interface AgentStore {
    get(col: string, id: string): Promise<Record<string, unknown> | null>;
    set(col: string, id: string, doc: Record<string, unknown>): Promise<void>;
    update(col: string, id: string, patch: Record<string, unknown>): Promise<void>;
    remove(col: string, id: string): Promise<void>;
    findByField(
        col: string,
        field: string,
        value: unknown
    ): Promise<Array<Record<string, unknown> & { id: string }>>;
    /**
     * Atomic single-use claim: if the doc is missing or `doc[field]` is
     * already truthy, returns null; otherwise stamps `doc[field] = Date.now()`
     * and returns the doc's PRE-claim contents. This is the one primitive
     * both single-use redemption paths (auth codes, refresh-token rotation)
     * must use — a plain get→check→update sequence lets two concurrent
     * callers both pass validation before either write lands.
     */
    claim(col: string, id: string, field: string): Promise<Record<string, unknown> | null>;
}

/**
 * `firestoreStore`'s `update`/`claim` hand `patch`/`field` straight to the
 * real Firestore SDK, where a dotted key (`"a.b"`) is NOT a literal top-level
 * field name — it addresses a NESTED field path. `memoryStore`'s flat
 * `{...existing, ...patch}` merge has no such semantics: it would silently
 * set/read a literal key spelled `"a.b"`. A test written against
 * `memoryStore` that happened to use a dotted key would keep passing here
 * while doing something genuinely different against production Firestore —
 * exactly the class of test-double/prod divergence this guard exists to
 * catch loudly, at the one place both `update` and `claim` accept a
 * caller-supplied key.
 */
function assertNoDottedKeys(keys: Iterable<string>, context: string): void {
    for (const key of keys) {
        if (key.includes(".")) {
            throw new Error(
                `memoryStore: ${context} key '${key}' contains '.' — Firestore reads dotted keys as nested-field ` +
                    "paths, not literal field names, so memoryStore refuses rather than silently diverging from it."
            );
        }
    }
}

/** Map-backed store, for unit tests. */
export function memoryStore(): AgentStore {
    const collections = new Map<string, Map<string, Record<string, unknown>>>();

    function collection(col: string): Map<string, Record<string, unknown>> {
        let docs = collections.get(col);
        if (!docs) {
            docs = new Map();
            collections.set(col, docs);
        }
        return docs;
    }

    return {
        async get(col, id) {
            const doc = collection(col).get(id);
            return doc ? structuredClone(doc) : null;
        },
        async set(col, id, doc) {
            collection(col).set(id, structuredClone(doc));
        },
        async update(col, id, patch) {
            assertNoDottedKeys(Object.keys(patch), "update patch");
            const existing = collection(col).get(id);
            if (!existing) {
                throw new Error(`NOT_FOUND: no document at ${col}/${id}`);
            }
            collection(col).set(id, { ...existing, ...structuredClone(patch) });
        },
        async remove(col, id) {
            collection(col).delete(id);
        },
        async findByField(col, field, value) {
            const results: Array<Record<string, unknown> & { id: string }> = [];
            for (const [id, doc] of collection(col)) {
                if (doc[field] === value) {
                    results.push({ ...structuredClone(doc), id });
                }
            }
            return results;
        },
        async claim(col, id, field) {
            assertNoDottedKeys([field], "claim field");
            // No `await` between the read and the write below: this function
            // body runs to completion synchronously (single JS thread, no
            // yield point), so two concurrent callers can never both observe
            // the pre-claim state.
            const docs = collection(col);
            const existing = docs.get(id);
            if (!existing || existing[field]) return null;
            const pre = structuredClone(existing);
            docs.set(id, { ...existing, [field]: Date.now() });
            return pre;
        },
    };
}

/** Firestore-backed store, wraps `getAdminDb()` from '@/lib/firebase/admin'. */
export function firestoreStore(): AgentStore {
    async function db() {
        const { getAdminDb } = await import("@/lib/firebase/admin");
        return getAdminDb();
    }

    return {
        async get(col, id) {
            const snap = await (await db()).collection(col).doc(id).get();
            return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        },
        async set(col, id, doc) {
            await (await db()).collection(col).doc(id).set(doc);
        },
        async update(col, id, patch) {
            await (await db()).collection(col).doc(id).update(patch);
        },
        async remove(col, id) {
            await (await db()).collection(col).doc(id).delete();
        },
        async findByField(col, field, value) {
            const snap = await (await db()).collection(col).where(field, "==", value).get();
            return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
        },
        async claim(col, id, field) {
            const database = await db();
            const ref = database.collection(col).doc(id);
            return database.runTransaction(async (t) => {
                const snap = await t.get(ref);
                if (!snap.exists || snap.get(field)) return null;
                t.update(ref, { [field]: Date.now() });
                return snap.data() as Record<string, unknown>;
            });
        },
    };
}

function specFor(col: string): CollectionSpec {
    const spec = (MIGRATION_MANIFEST as readonly CollectionSpec[]).find((s) => s.collection === col);
    if (!spec) {
        throw new Error(`postgresStore: '${col}' has no entry in MIGRATION_MANIFEST — nowhere to route it in Postgres`);
    }
    return spec;
}

function tableRef(spec: CollectionSpec): string {
    return `"${INTERVU_SCHEMA}"."${spec.table}"`;
}

/** Full Firestore document path convention (`scripts/firestore-export.ts`'s
 *  `doc.ref.path`, the primary key every table in MIGRATION_MANIFEST uses) —
 *  kept identical here so a live-written row and a backfilled row are
 *  indistinguishable, and a live write upserts onto the same key a re-run of
 *  the backfill would target. */
function pathFor(col: string, id: string): string {
    return `${col}/${id}`;
}

function idFromPath(path: string, col: string): string {
    return path.slice(col.length + 1);
}

/**
 * Postgres-backed AgentStore. Generic over any collection present in
 * MIGRATION_MANIFEST — table name and indexed columns are resolved from the
 * manifest (the single source of truth `pg-generate-schema.ts` also reads),
 * so routing another agent_* collection through Postgres later needs no
 * change here, only an entry in PG_LIVE_COLLECTIONS. Mirrors the
 * upsert-on-path idiom `deploy/db-box/load-firestore-export.sh` already uses
 * for the one-time backfill.
 */
export function postgresStore(pg: Queryable): AgentStore {
    return {
        async get(col, id) {
            const spec = specFor(col);
            const { rows } = await pg.query<{ doc: Record<string, unknown> }>(
                `SELECT doc FROM ${tableRef(spec)} WHERE path = $1`,
                [pathFor(col, id)]
            );
            return rows[0]?.doc ?? null;
        },
        async set(col, id, doc) {
            const spec = specFor(col);
            await pg.query(
                `INSERT INTO ${tableRef(spec)} (path, doc) VALUES ($1, $2::jsonb)
                 ON CONFLICT (path) DO UPDATE SET doc = EXCLUDED.doc, copied_at = now()`,
                [pathFor(col, id), JSON.stringify(doc)]
            );
        },
        async update(col, id, patch) {
            const spec = specFor(col);
            const { rows } = await pg.query(
                `UPDATE ${tableRef(spec)} SET doc = doc || $2::jsonb, copied_at = now() WHERE path = $1 RETURNING path`,
                [pathFor(col, id), JSON.stringify(patch)]
            );
            if (rows.length === 0) {
                throw new Error(`NOT_FOUND: no document at ${col}/${id}`);
            }
        },
        async remove(col, id) {
            const spec = specFor(col);
            await pg.query(`DELETE FROM ${tableRef(spec)} WHERE path = $1`, [pathFor(col, id)]);
        },
        async findByField(col, field, value) {
            const spec = specFor(col);
            const indexed = spec.indexed.find((f) => f.field === field);
            // Indexed fields read their generated column directly (the
            // bearer-token lookup this exists for must not table-scan — see
            // the manifest's comment on agent_credentials.tokenHash);
            // anything else falls back to a jsonb key extraction, with the
            // key itself passed as a bind parameter rather than spliced into
            // the query text.
            const { text, params } = indexed
                ? { text: `SELECT path, doc FROM ${tableRef(spec)} WHERE "${columnNameFor(indexed)}" = $1`, params: [value] }
                : { text: `SELECT path, doc FROM ${tableRef(spec)} WHERE doc->>$2 = $1`, params: [value, field] };
            const { rows } = await pg.query<{ path: string; doc: Record<string, unknown> }>(text, params);
            return rows.map((r) => ({ ...r.doc, id: idFromPath(r.path, col) }));
        },
        async claim(col, id, field) {
            const spec = specFor(col);
            const patch = JSON.stringify({ [field]: Date.now() });
            // A single WHERE-guarded UPDATE, not a CTE that reads the same
            // table it writes: Postgres's row-lock + EvalPlanQual re-check on
            // a plain UPDATE's own WHERE clause is the well-understood,
            // race-safe primitive this single-use claim depends on (two
            // concurrent claims of the same row: the loser's WHERE clause is
            // re-evaluated against the winner's committed row and matches
            // zero rows).
            const { rows } = await pg.query<{ doc: Record<string, unknown> }>(
                `UPDATE ${tableRef(spec)} SET doc = doc || $2::jsonb, copied_at = now()
                 WHERE path = $1 AND doc->>$3 IS NULL
                 RETURNING doc`,
                [pathFor(col, id), patch, field]
            );
            if (rows.length === 0) return null;
            // `rows[0].doc` is the POST-claim row. Every collection this
            // store serves writes the claimed field as an explicit JSON
            // `null` at creation (never an absent key — see tokens.ts's
            // `revokedAt: null`), so reverting just that field to `null`
            // reconstructs the exact pre-claim document `memoryStore.claim`
            // returns, without a second read.
            return { ...rows[0].doc, [field]: null };
        },
    };
}

/**
 * Collections routed to Postgres, read from AGENT_PG_LIVE_COLLECTIONS (a
 * comma-separated list of Firestore collection ids, e.g.
 * "agent_credentials"). Empty/unset by default, so merging and deploying
 * this module changes nothing on its own — flipping this env var is the
 * entire cutover for a collection once its backfill is verified (see
 * deploy/db-box/verify-firestore-load.sh), and unflipping it is the entire
 * rollback. No second code change or redeploy either way.
 */
function pgLiveCollections(): ReadonlySet<string> {
    const raw = process.env.AGENT_PG_LIVE_COLLECTIONS ?? "";
    return new Set(
        raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

/**
 * The one chokepoint that decides, per collection, whether a call goes to
 * Postgres or Firestore — replaces 8 independent `firestoreStore()` call
 * sites (oauth routes, viewer-session routes, agent-consent/agent-access
 * actions, the MCP route) with a single dispatcher every one of them now
 * calls instead. Never falls back to Firestore for a collection
 * AGENT_PG_LIVE_COLLECTIONS names: once a collection is live, Firestore stops
 * receiving new writes for it, so silently serving stale Firestore reads
 * would be a lying fallback — worse, a security one (a credential revoked in
 * Postgres would still verify against a Firestore row that never saw the
 * revocation). Unconfigured AGENT_PG_URL is therefore a loud throw, not a
 * silent downgrade, for exactly the collections that need it.
 */
export function getAgentStore(): AgentStore {
    const live = pgLiveCollections();
    const firestore = firestoreStore();
    let pgStore: AgentStore | null = null;

    function storeFor(col: string): AgentStore {
        if (!live.has(col)) return firestore;
        if (!pgStore) {
            const pg = getAgentPg();
            if (!pg) {
                throw new Error(
                    `getAgentStore: AGENT_PG_LIVE_COLLECTIONS names '${col}' but AGENT_PG_URL is unset — refusing to ` +
                        "silently fall back to Firestore, which no longer receives writes for a live collection."
                );
            }
            pgStore = postgresStore(pg);
        }
        return pgStore;
    }

    // Every method below is `async` even though `storeFor` itself is
    // synchronous: `storeFor` throws (loudly, on purpose — see above) when a
    // live collection has no configured pool, and production code chains
    // `.catch()` directly off these calls (tokens.ts's `lastUsedAt` update).
    // A bare arrow function lets a synchronous throw escape as an uncaught
    // exception instead of a rejected promise, silently breaking that
    // `.catch()`; `async` normalizes both throw paths (this dispatcher's own
    // synchronous throw, and the underlying store's rejected promises) into
    // one Promise contract, matching the AgentStore interface it implements.
    return {
        get: async (col, id) => storeFor(col).get(col, id),
        set: async (col, id, doc) => storeFor(col).set(col, id, doc),
        update: async (col, id, patch) => storeFor(col).update(col, id, patch),
        remove: async (col, id) => storeFor(col).remove(col, id),
        findByField: async (col, field, value) => storeFor(col).findByField(col, field, value),
        claim: async (col, id, field) => storeFor(col).claim(col, id, field),
    };
}

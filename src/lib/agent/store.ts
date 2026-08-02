/**
 * Storage seam for the agent/MCP feature.
 *
 * `memoryStore` is a Map-backed test double used by every later task's unit
 * tests. `firestoreStore` is the production implementation. Nothing from
 * `firebase-admin` is imported at module top-level — the import happens
 * lazily inside `firestoreStore()`'s returned methods so importing this file
 * (or calling `memoryStore()`) never touches admin credentials.
 */
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

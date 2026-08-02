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
    };
}

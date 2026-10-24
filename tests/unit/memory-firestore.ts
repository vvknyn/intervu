/**
 * A small in-memory stand-in for the Firestore calls the billing and retention code makes.
 * Not a test file (no .test.ts): imported by the tests that need a store.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
const isDelete = (v: unknown) => v instanceof (FieldValue.delete().constructor as new () => object);

function setPath(target: Data, dotted: string, value: unknown) {
    const keys = dotted.split(".");
    let node = target;
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Data;
    if (isDelete(value)) delete node[keys[keys.length - 1]];
    else node[keys[keys.length - 1]] = value;
}

export function memoryFirestore(seed: Record<string, Data> = {}) {
    const docs = new Map<string, Data>(Object.entries(seed).map(([p, d]) => [p, structuredClone(d)]));
    const writes: string[] = [];

    const snapOf = (path: string) => {
        const data = docs.get(path);
        return { id: path.split("/").pop()!, exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined), ref: refOf(path) };
    };
    const refOf = (path: string): any => ({
        id: path.split("/").pop()!,
        path,
        get: async () => snapOf(path),
        set: async (data: Data, opts?: { merge?: boolean }) => {
            writes.push(`set ${path}`);
            const next = opts?.merge ? { ...(docs.get(path) ?? {}) } : {};
            for (const [k, v] of Object.entries(data)) setPath(next, k, isDelete(v) ? v : structuredClone(v));
            docs.set(path, next);
        },
        update: async (patch: Data) => {
            writes.push(`update ${path}`);
            const next = structuredClone(docs.get(path) ?? {});
            for (const [k, v] of Object.entries(patch)) setPath(next, k, v);
            docs.set(path, next);
        },
        delete: async () => {
            writes.push(`delete ${path}`);
            docs.delete(path);
        },
        collection: (name: string) => collectionOf(`${path}/${name}`),
    });
    const collectionOf = (name: string): any => {
        const filters: ((id: string, d: Data) => boolean)[] = [];
        let max = Infinity;
        const q: any = {
            doc: (id: string) => refOf(`${name}/${id}`),
            where: (field: unknown, op: string, value: unknown) => {
                const byId = typeof field !== "string"; // FieldPath.documentId()
                filters.push((id, d) => {
                    const actual = byId ? id : d[field as string];
                    return op === "==" ? actual === value : op === ">=" ? String(actual) >= String(value) : String(actual) < String(value);
                });
                return q;
            },
            limit: (n: number) => ((max = n), q),
            select: () => q,
            get: async () => {
                const prefix = `${name}/`;
                const hits = [...docs.entries()]
                    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
                    .filter(([p, d]) => filters.every((f) => f(p.slice(prefix.length), d)))
                    .slice(0, max)
                    .map(([p]) => snapOf(p));
                return { docs: hits, empty: hits.length === 0, size: hits.length };
            },
        };
        return q;
    };

    const db = {
        collection: collectionOf,
        doc: refOf,
        batch: () => {
            const ops: (() => Promise<void>)[] = [];
            return {
                update: (ref: any, patch: Data) => ops.push(() => ref.update(patch)),
                delete: (ref: any) => ops.push(() => ref.delete()),
                set: (ref: any, data: Data, o?: { merge?: boolean }) => ops.push(() => ref.set(data, o)),
                commit: async () => {
                    for (const op of ops) await op();
                },
            };
        },
        runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
            const pending: (() => Promise<void>)[] = [];
            const result = await fn({
                get: (ref: any) => ref.get(),
                set: (ref: any, data: Data, o?: { merge?: boolean }) => pending.push(() => ref.set(data, o)),
            });
            for (const p of pending) await p();
            return result;
        },
    };
    return { db: db as unknown as Firestore, docs, writes };
}

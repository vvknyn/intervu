/**
 * Account data on our own Postgres, sealed, behind Firestore's API.
 *
 * WHY THIS SHAPE. Vivek, 2026-10-08: "I dont want ANYTHING on firestore" and
 * "encrypt everything". About 40 files read and write account data through
 * `getAdminDb()` with Firestore's API (collection/doc/where/orderBy/batch/
 * runTransaction). Rewriting each one against a new interface would touch
 * every account feature at once. Instead `getAdminDb()` hands them this
 * store when DATA_STORE=postgres: the same calls, answered from the
 * `intervu` schema on the DB box, with every document sealed by seal.ts.
 * The switch is an env var, so the deploy that ships this changes nothing
 * until the data has been copied and the switch is flipped, and flipping it
 * back is the rollback until Firestore is wiped.
 *
 * Only the part of Firestore's API this codebase uses is implemented. A call
 * outside it throws with the method's name rather than doing something
 * subtly different.
 *
 * STORAGE. One table per collection (MIGRATION_MANIFEST), keyed by the
 * document path. `sealed` holds the whole document; `doc` holds only the
 * lookup fields layout.ts allows, which is what the generated, indexed
 * columns read. Rows written before sealing (`sealed` IS NULL: the old
 * one-off copy, or agent rows written by agent/store.ts's postgresStore) are
 * read as plain documents until the copy script reseals them.
 *
 * WRITES run in SERIALIZABLE transactions and retry on serialization
 * failure, which gives merges, updates and transactions the same atomicity
 * Firestore's server gives them.
 */
import { randomBytes } from "crypto";
import { Pool, type PoolClient } from "pg";

import { layoutOf, type CollectionLayout } from "./layout";
import { docKeysFromEnv, lookupHash, open, seal, type DocKeys } from "./seal";
import {
    DOC_ID,
    fieldName,
    mergeDoc,
    project,
    replaceDoc,
    runQuery,
    updateDoc,
    type Candidate,
    type DocData,
    type Filter,
    type Order,
    type WhereOp,
} from "./values";
import { INTERVU_SCHEMA } from "../firestore-migration-manifest";

/** Errors carry Firestore's gRPC codes, which callers already check
 *  (welcome.ts treats 6 as "someone else claimed this first"). */
export class DocStoreError extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = "DocStoreError";
    }
}
const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;

const MAX_TX_ATTEMPTS = 6;
const STATEMENT_TIMEOUT = "15s";

interface Row {
    path: string;
    doc: DocData;
    sealed: string | null;
}

// ---------------------------------------------------------------------------
// Paths

function splitPath(path: string): string[] {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) throw new Error("empty document path");
    return segments;
}

const AUTO_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A 20-character id like Firestore's auto ids. */
export function autoId(): string {
    const bytes = randomBytes(40);
    let id = "";
    for (const b of bytes) {
        if (b >= 248) continue; // 248 = 62 * 4: keep the alphabet uniform
        id += AUTO_ID_CHARS[b % 62];
        if (id.length === 20) return id;
    }
    return id + autoId().slice(0, 20 - id.length);
}

// ---------------------------------------------------------------------------
// The engine: rows in, rows out, sealing on the way.

export class Engine {
    constructor(
        readonly pool: Pool,
        readonly keys: DocKeys,
    ) {}

    table(layout: CollectionLayout): string {
        return `"${INTERVU_SCHEMA}"."${layout.table}"`;
    }

    /** The key a document is stored under: its path, with the id hashed for
     *  collections whose ids are emails. */
    storedPath(layout: CollectionLayout, realPath: string): string {
        if (!layout.hashIds) return realPath;
        const segments = splitPath(realPath);
        const id = segments.pop()!;
        return [...segments, lookupHash(this.keys, id)].join("/");
    }

    encode(layout: CollectionLayout, realPath: string, data: DocData): { path: string; doc: string; sealed: string } {
        const path = this.storedPath(layout, realPath);
        const lookup: DocData = {};
        for (const field of layout.readable) {
            if (data[field] !== undefined) lookup[field] = data[field];
        }
        for (const field of layout.hashed) {
            if (data[field] !== undefined && data[field] !== null) lookup[field] = lookupHash(this.keys, data[field]);
        }
        return { path, doc: JSON.stringify(lookup), sealed: seal(this.keys, path, { p: realPath, d: data }) };
    }

    decode(row: Row): { path: string; data: DocData } {
        if (row.sealed === null) return { path: row.path, data: row.doc };
        const opened = open(this.keys, row.path, row.sealed) as { p: string; d: DocData };
        return { path: opened.p, data: opened.d };
    }

    async read(client: PoolClient | Pool, layout: CollectionLayout, realPath: string, lock: boolean): Promise<DocData | null> {
        const { rows } = await client.query<Row>(
            `SELECT path, doc, sealed FROM ${this.table(layout)} WHERE path = $1${lock ? " FOR UPDATE" : ""}`,
            [this.storedPath(layout, realPath)],
        );
        return rows[0] ? this.decode(rows[0]).data : null;
    }

    async write(client: PoolClient, layout: CollectionLayout, realPath: string, data: DocData, mode: "upsert" | "insert"): Promise<void> {
        const row = this.encode(layout, realPath, data);
        const conflict =
            mode === "upsert" ? ` ON CONFLICT (path) DO UPDATE SET doc = EXCLUDED.doc, sealed = EXCLUDED.sealed, copied_at = now()` : "";
        try {
            await client.query(
                `INSERT INTO ${this.table(layout)} (path, doc, sealed, copied_at) VALUES ($1, $2::jsonb, $3, now())${conflict}`,
                [row.path, row.doc, row.sealed],
            );
        } catch (err) {
            if ((err as { code?: string }).code === "23505" && mode === "insert") {
                throw new DocStoreError(ALREADY_EXISTS, `6 ALREADY_EXISTS: Document already exists: ${realPath}`);
            }
            throw err;
        }
    }

    async remove(client: PoolClient, layout: CollectionLayout, realPath: string): Promise<void> {
        await client.query(`DELETE FROM ${this.table(layout)} WHERE path = $1`, [this.storedPath(layout, realPath)]);
    }

    /** Runs `fn` in a SERIALIZABLE transaction, retrying when Postgres
     *  reports a conflicting concurrent transaction. */
    async transact<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            const client = await this.pool.connect();
            try {
                await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
                await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
                const result = await fn(client);
                await client.query("COMMIT");
                return result;
            } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                const code = (err as { code?: string }).code;
                if ((code === "40001" || code === "40P01") && attempt < MAX_TX_ATTEMPTS) {
                    await new Promise((r) => setTimeout(r, 10 * attempt + Math.floor(Math.random() * 20)));
                    continue;
                }
                throw err;
            } finally {
                client.release();
            }
        }
    }

    async applyWrites(client: PoolClient, ops: WriteOp[]): Promise<void> {
        for (const op of ops) {
            const layout = layoutOf(op.ref.parent.id);
            const path = op.ref.path;
            switch (op.kind) {
                case "set": {
                    const next = op.merge
                        ? mergeDoc(await this.read(client, layout, path, true), op.data)
                        : replaceDoc(op.data);
                    await this.write(client, layout, path, next, "upsert");
                    break;
                }
                case "update": {
                    const current = await this.read(client, layout, path, true);
                    if (!current) throw new DocStoreError(NOT_FOUND, `5 NOT_FOUND: No document to update: ${path}`);
                    await this.write(client, layout, path, updateDoc(current, op.data), "upsert");
                    break;
                }
                case "create":
                    await this.write(client, layout, path, replaceDoc(op.data), "insert");
                    break;
                case "delete":
                    await this.remove(client, layout, path);
                    break;
            }
        }
    }

    // --- queries -----------------------------------------------------------

    async runQuery(client: PoolClient | Pool, q: QueryState): Promise<Candidate[]> {
        const layout = layoutOf(q.collectionId);
        const plan = this.plan(layout, q);
        const { rows } = await client.query<Row>(
            `SELECT path, doc, sealed FROM ${this.table(layout)}${plan.where}${plan.tail}`,
            plan.params,
        );
        const candidates = rows.map((row) => {
            const { path, data } = this.decode(row);
            return { id: path.slice(path.lastIndexOf("/") + 1), path, data };
        });
        // Always re-applied in memory: exact Firestore semantics whatever was
        // or wasn't pushed into SQL.
        return runQuery(candidates, q.filters, q.orders, q.limit);
    }

    async count(client: PoolClient | Pool, q: QueryState): Promise<number> {
        const layout = layoutOf(q.collectionId);
        const plan = this.plan(layout, { ...q, orders: [] });
        if (plan.complete) {
            const inner = `SELECT 1 FROM ${this.table(layout)}${plan.where}${q.limit !== null ? ` LIMIT ${q.limit}` : ""}`;
            const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${inner}) AS hits`, plan.params);
            return Number(rows[0]?.n ?? 0);
        }
        return (await this.runQuery(client, q)).length;
    }

    /**
     * Turns as much of a query as is safe into SQL. A filter is pushed only
     * when SQL can answer it exactly (readable fields, keyed-hash equality,
     * document ids); anything else is left for the in-memory pass, which
     * then also owns ordering and the limit.
     */
    plan(layout: CollectionLayout, q: QueryState): { where: string; tail: string; params: unknown[]; complete: boolean } {
        const params: unknown[] = [];
        const bind = (v: unknown) => {
            params.push(v);
            return `$${params.length}`;
        };
        const conds: string[] = [];
        if (q.parentPath !== null) conds.push(`starts_with(path, ${bind(`${q.parentPath}/${q.collectionId}/`)})`);
        let complete = true;

        for (const f of q.filters) {
            const sql = this.filterSql(layout, q, f, bind);
            if (sql) conds.push(sql);
            else complete = false;
        }

        let tail = "";
        const orderable = q.orders.every((o) =>
            o.field === DOC_ID ? !layout.hashIds : layout.readable.has(o.field) && !o.field.includes("."),
        );
        if (complete && orderable && !(layout.hashIds && q.limit !== null)) {
            const parts: string[] = [];
            for (const o of q.orders) {
                const dir = o.dir === "desc" ? "DESC" : "ASC";
                if (o.field === DOC_ID) {
                    parts.push(`path COLLATE "C" ${dir}`);
                    continue;
                }
                const f = bind(o.field);
                conds.push(`doc ? ${f}`);
                parts.push(
                    `(CASE jsonb_typeof(doc->${f}) WHEN 'null' THEN 0 WHEN 'boolean' THEN 1 WHEN 'number' THEN 2 WHEN 'string' THEN 4 WHEN 'array' THEN 8 ELSE 9 END) ${dir}`,
                    `(CASE WHEN jsonb_typeof(doc->${f}) = 'boolean' THEN (doc->>${f})::boolean END) ${dir}`,
                    `(CASE WHEN jsonb_typeof(doc->${f}) = 'number' THEN (doc->>${f})::numeric END) ${dir}`,
                    `(CASE WHEN jsonb_typeof(doc->${f}) = 'string' THEN doc->>${f} END) COLLATE "C" ${dir}`,
                );
            }
            const lastDir = q.orders.length && q.orders[q.orders.length - 1].dir === "desc" ? "DESC" : "ASC";
            parts.push(`path COLLATE "C" ${lastDir}`);
            tail = ` ORDER BY ${parts.join(", ")}${q.limit !== null ? ` LIMIT ${q.limit}` : ""}`;
        } else {
            complete = false;
        }
        return { where: conds.length ? ` WHERE ${conds.join(" AND ")}` : "", tail, params, complete };
    }

    private filterSql(layout: CollectionLayout, q: QueryState, f: Filter, bind: (v: unknown) => string): string | null {
        const base = q.parentPath !== null ? `${q.parentPath}/${q.collectionId}` : q.collectionId;
        if (f.field === DOC_ID) {
            // A collection-group query over a subcollection spans many
            // parents, so a bare id names no single path.
            if (q.parentPath === null && layout.spec.subcollectionOf) return null;
            const pathOf = (id: unknown) => {
                if (typeof id !== "string" || id.includes("/")) return null;
                return this.storedPath(layout, `${base}/${id}`);
            };
            if (f.op === "==") {
                const p = pathOf(f.value);
                return p === null ? null : `path = ${bind(p)}`;
            }
            if (f.op === "in" && Array.isArray(f.value)) {
                const ps = f.value.map(pathOf);
                return ps.some((p) => p === null) ? null : `path = ANY(${bind(ps)}::text[])`;
            }
            if (!layout.hashIds && (f.op === "<" || f.op === "<=" || f.op === ">" || f.op === ">=")) {
                const p = pathOf(f.value);
                return p === null ? null : `path COLLATE "C" ${f.op} ${bind(p)}`;
            }
            return null;
        }
        if (f.field.includes(".")) return null;
        if (layout.hashed.has(f.field)) {
            if (f.op === "==" && f.value !== null) return `doc->>${bind(f.field)} = ${bind(lookupHash(this.keys, f.value))}`;
            if (f.op === "in" && Array.isArray(f.value) && !f.value.includes(null)) {
                return `doc->>${bind(f.field)} = ANY(${bind(f.value.map((v) => lookupHash(this.keys, v)))}::text[])`;
            }
            return null;
        }
        if (!layout.readable.has(f.field)) return null;
        const field = bind(f.field);
        if (f.op === "==") return `doc->${field} = ${bind(JSON.stringify(f.value))}::jsonb`;
        if (f.op === "in" && Array.isArray(f.value)) {
            return `doc->${field} = ANY(${bind(f.value.map((v) => JSON.stringify(v)))}::jsonb[])`;
        }
        if (f.op === "<" || f.op === "<=" || f.op === ">" || f.op === ">=") {
            if (typeof f.value === "string") {
                return `jsonb_typeof(doc->${field}) = 'string' AND (doc->>${field}) COLLATE "C" ${f.op} ${bind(f.value)}`;
            }
            if (typeof f.value === "number" && Number.isFinite(f.value)) {
                return `jsonb_typeof(doc->${field}) = 'number' AND (doc->>${field})::numeric ${f.op} ${bind(String(f.value))}::numeric`;
            }
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Firestore-shaped API

type WriteOp =
    | { kind: "set"; ref: DocRef; data: DocData; merge: boolean }
    | { kind: "update"; ref: DocRef; data: DocData }
    | { kind: "create"; ref: DocRef; data: DocData }
    | { kind: "delete"; ref: DocRef };

interface SetOptions {
    merge?: boolean;
    mergeFields?: unknown;
}

function setOp(ref: DocRef, data: DocData, options?: SetOptions): WriteOp {
    if (options?.mergeFields !== undefined) throw new Error("Postgres store: set() with mergeFields is not supported");
    return { kind: "set", ref, data, merge: options?.merge === true };
}

function updateOp(ref: DocRef, data: unknown, rest: unknown[]): WriteOp {
    if (rest.length > 0 || data === null || typeof data !== "object") {
        throw new Error("Postgres store: update() takes one object of field paths");
    }
    return { kind: "update", ref, data: data as DocData };
}

const WRITE_RESULT = () => ({ writeTime: new Date().toISOString() });

export class DocSnap {
    constructor(
        readonly ref: DocRef,
        private readonly value: DocData | null,
    ) {}
    get id(): string {
        return this.ref.id;
    }
    get exists(): boolean {
        return this.value !== null;
    }
    data(): DocData | undefined {
        return this.value === null ? undefined : structuredClone(this.value);
    }
    get(field: unknown): unknown {
        if (this.value === null) return undefined;
        let node: unknown = this.value;
        for (const segment of fieldName(field).split(".")) {
            if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
            node = (node as DocData)[segment];
        }
        return node === undefined ? undefined : structuredClone(node);
    }
}

export class QuerySnap {
    constructor(readonly docs: DocSnap[]) {}
    get size(): number {
        return this.docs.length;
    }
    get empty(): boolean {
        return this.docs.length === 0;
    }
    forEach(cb: (doc: DocSnap) => void): void {
        this.docs.forEach(cb);
    }
}

interface QueryState {
    collectionId: string;
    /** The parent document's path, or null for a root collection or a
     *  collection group (all parents). */
    parentPath: string | null;
    filters: Filter[];
    orders: Order[];
    limit: number | null;
    select: string[] | null;
}

class Query {
    constructor(
        protected readonly db: PgDocDb,
        protected readonly state: QueryState,
    ) {}

    private with(patch: Partial<QueryState>): Query {
        return new Query(this.db, { ...this.state, ...patch });
    }

    where(field: unknown, op: WhereOp, value: unknown): Query {
        if (typeof field === "object" && field !== null && !("formattedName" in (field as object))) {
            throw new Error("Postgres store: where() with a Filter object is not supported");
        }
        return this.with({ filters: [...this.state.filters, { field: fieldName(field), op, value }] });
    }

    orderBy(field: unknown, dir: "asc" | "desc" = "asc"): Query {
        return this.with({ orders: [...this.state.orders, { field: fieldName(field), dir }] });
    }

    limit(n: number): Query {
        if (!Number.isInteger(n) || n < 0) throw new Error(`limit(${n}) must be a non-negative integer`);
        return this.with({ limit: n });
    }

    select(...fields: unknown[]): Query {
        return this.with({ select: fields.map(fieldName) });
    }

    count(): { get(): Promise<{ data(): { count: number } }> } {
        return {
            get: async () => {
                const n = await this.db.engine.count(this.db.engine.pool, this.state);
                return { data: () => ({ count: n }) };
            },
        };
    }

    async get(): Promise<QuerySnap> {
        return this.db.snapshotOf(await this.db.engine.runQuery(this.db.engine.pool, this.state), this.state.select);
    }

    /** @internal transactions read through this */
    get queryState(): QueryState {
        return this.state;
    }
}

export class CollectionRef extends Query {
    constructor(
        db: PgDocDb,
        readonly path: string,
    ) {
        const segments = splitPath(path);
        if (segments.length % 2 !== 1) throw new Error(`'${path}' is a document path, not a collection path`);
        super(db, {
            collectionId: segments[segments.length - 1],
            parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : null,
            filters: [],
            orders: [],
            limit: null,
            select: null,
        });
        // Not validated here: `users` is only ever a parent segment
        // (users/<uid>/savedSearches), never a table. Reads and writes
        // check the collection when they reach the engine.
    }
    get id(): string {
        return this.path.slice(this.path.lastIndexOf("/") + 1);
    }
    get parent(): DocRef | null {
        const i = this.path.lastIndexOf("/");
        return i < 0 ? null : new DocRef(this.db, this.path.slice(0, i));
    }
    doc(id?: string): DocRef {
        return new DocRef(this.db, `${this.path}/${id ?? autoId()}`);
    }
    async add(data: DocData): Promise<DocRef> {
        const ref = this.doc();
        await ref.create(data);
        return ref;
    }
}

export class DocRef {
    constructor(
        private readonly db: PgDocDb,
        readonly path: string,
    ) {
        const segments = splitPath(path);
        if (segments.length % 2 !== 0) throw new Error(`'${path}' is a collection path, not a document path`);
    }
    get id(): string {
        return this.path.slice(this.path.lastIndexOf("/") + 1);
    }
    get parent(): CollectionRef {
        return new CollectionRef(this.db, this.path.slice(0, this.path.lastIndexOf("/")));
    }
    collection(id: string): CollectionRef {
        return new CollectionRef(this.db, `${this.path}/${id}`);
    }
    isEqual(other: unknown): boolean {
        return other instanceof DocRef && other.path === this.path;
    }
    async get(): Promise<DocSnap> {
        const data = await this.db.engine.read(this.db.engine.pool, layoutOf(this.parent.id), this.path, false);
        return new DocSnap(this, data);
    }
    async set(data: DocData, options?: SetOptions) {
        await this.db.commit([setOp(this, data, options)]);
        return WRITE_RESULT();
    }
    async update(data: unknown, ...rest: unknown[]) {
        await this.db.commit([updateOp(this, data, rest)]);
        return WRITE_RESULT();
    }
    async create(data: DocData) {
        await this.db.commit([{ kind: "create", ref: this, data }]);
        return WRITE_RESULT();
    }
    async delete() {
        await this.db.commit([{ kind: "delete", ref: this }]);
        return WRITE_RESULT();
    }
}

export class WriteBatch {
    private readonly ops: WriteOp[] = [];
    private committed = false;
    constructor(private readonly db: PgDocDb) {}
    set(ref: DocRef, data: DocData, options?: SetOptions): this {
        this.ops.push(setOp(ref, data, options));
        return this;
    }
    update(ref: DocRef, data: unknown, ...rest: unknown[]): this {
        this.ops.push(updateOp(ref, data, rest));
        return this;
    }
    create(ref: DocRef, data: DocData): this {
        this.ops.push({ kind: "create", ref, data });
        return this;
    }
    delete(ref: DocRef): this {
        this.ops.push({ kind: "delete", ref });
        return this;
    }
    async commit() {
        if (this.committed) throw new Error("this batch has already been committed");
        this.committed = true;
        await this.db.commit(this.ops);
        return this.ops.map(WRITE_RESULT);
    }
}

export class Transaction {
    readonly ops: WriteOp[] = [];
    constructor(
        private readonly db: PgDocDb,
        private readonly client: PoolClient,
    ) {}
    async get(target: DocRef | Query): Promise<DocSnap | QuerySnap> {
        if (this.ops.length) throw new Error("Firestore transactions require all reads before any writes");
        if (target instanceof DocRef) {
            const data = await this.db.engine.read(this.client, layoutOf(target.parent.id), target.path, true);
            return new DocSnap(target, data);
        }
        const state = target.queryState;
        return this.db.snapshotOf(await this.db.engine.runQuery(this.client, state), state.select);
    }
    set(ref: DocRef, data: DocData, options?: SetOptions): this {
        this.ops.push(setOp(ref, data, options));
        return this;
    }
    update(ref: DocRef, data: unknown, ...rest: unknown[]): this {
        this.ops.push(updateOp(ref, data, rest));
        return this;
    }
    create(ref: DocRef, data: DocData): this {
        this.ops.push({ kind: "create", ref, data });
        return this;
    }
    delete(ref: DocRef): this {
        this.ops.push({ kind: "delete", ref });
        return this;
    }
}

export class PgDocDb {
    constructor(readonly engine: Engine) {}

    collection(path: string): CollectionRef {
        return new CollectionRef(this, path);
    }
    doc(path: string): DocRef {
        return new DocRef(this, path);
    }
    collectionGroup(collectionId: string): Query {
        layoutOf(collectionId);
        return new Query(this, { collectionId, parentPath: null, filters: [], orders: [], limit: null, select: null });
    }
    batch(): WriteBatch {
        return new WriteBatch(this);
    }
    async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
        return this.engine.transact(async (client) => {
            const tx = new Transaction(this, client);
            const result = await fn(tx);
            await this.engine.applyWrites(client, tx.ops);
            return result;
        });
    }

    /** @internal */
    async commit(ops: WriteOp[]): Promise<void> {
        if (ops.length === 0) return;
        await this.engine.transact((client) => this.engine.applyWrites(client, ops));
    }

    /** @internal */
    snapshotOf(rows: Candidate[], select: string[] | null): QuerySnap {
        return new QuerySnap(rows.map((row) => new DocSnap(this.doc(row.path), select ? project(row.data, select) : row.data)));
    }
}

/** Builds a store over an explicit pool and keys (tests, the copy script). */
export function createPgDocDb(pool: Pool, keys: DocKeys): PgDocDb {
    return new PgDocDb(new Engine(pool, keys));
}

let shared: PgDocDb | null = null;

/** The app's store: DATA_PG_URL for the connection, DATA_ENCRYPTION_KEY for
 *  the seal. Either missing is a loud error, never a fallback. */
export function getPgDocDb(): PgDocDb {
    if (shared) return shared;
    const url = process.env.DATA_PG_URL?.trim();
    if (!url) throw new Error("DATA_STORE=postgres but DATA_PG_URL is not set");
    const keys = docKeysFromEnv();
    const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    pool.on("error", (err) => console.error("[docstore] idle client error:", err.message));
    shared = createPgDocDb(pool, keys);
    return shared;
}

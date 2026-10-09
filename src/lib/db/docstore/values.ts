/**
 * Firestore's document semantics, as plain functions over JSON-shaped data,
 * so the Postgres store (pg-docstore.ts) behaves the way the 40-odd call
 * sites written against Firestore expect: how `set(..., { merge: true })`
 * merges nested maps, how `update()` reads dotted keys, what
 * `FieldValue.delete()` / `FieldValue.increment()` do, how `where()` compares
 * values of different types, and how `orderBy()` sorts them.
 *
 * Nothing here touches a database, so every rule is unit-tested directly
 * (tests/unit/docstore-values.test.ts).
 */

export type DocData = Record<string, unknown>;

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";

export interface Filter {
    /** A field name, a dotted path, or DOC_ID for the document id. */
    field: string;
    op: WhereOp;
    value: unknown;
}

export interface Order {
    field: string;
    dir: "asc" | "desc";
}

/** The field name Firestore uses for the document id (FieldPath.documentId()). */
export const DOC_ID = "__name__";

/**
 * Firestore's write sentinels (FieldValue.delete() and friends) are classes
 * inside firebase-admin. They are recognised by the `methodName` each one
 * reports rather than by importing firebase-admin here, so this store never
 * loads the Firestore SDK.
 */
type Sentinel =
    | { kind: "delete" }
    | { kind: "increment"; by: number }
    | { kind: "unsupported"; name: string };

export function sentinelOf(value: unknown): Sentinel | null {
    if (value === null || typeof value !== "object") return null;
    const name = (value as { methodName?: unknown }).methodName;
    if (typeof name !== "string" || !name.startsWith("FieldValue.")) return null;
    if (name === "FieldValue.delete") return { kind: "delete" };
    if (name === "FieldValue.increment") {
        const by = (value as { operand?: unknown }).operand;
        if (typeof by !== "number") throw new Error("FieldValue.increment() without a numeric operand");
        return { kind: "increment", by };
    }
    return { kind: "unsupported", name };
}

/** The field a `where()`/`orderBy()` names, as a string: plain names and
 *  dotted paths pass through, FieldPath objects (FieldPath.documentId())
 *  become their formatted name. */
export function fieldName(field: unknown): string {
    if (typeof field === "string") return field;
    if (field !== null && typeof field === "object") {
        const text = String(field);
        if (text && text !== "[object Object]") return text;
    }
    throw new Error(`unsupported field reference: ${String(field)}`);
}

function isPlainMap(value: unknown): value is DocData {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        sentinelOf(value) === null &&
        !(value instanceof Date) &&
        !hasToDate(value)
    );
}

function hasToDate(value: unknown): value is { toDate(): Date } {
    return value !== null && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function";
}

/**
 * A value as it will be stored: Dates and Firestore Timestamps become ISO
 * strings (a 2026-08-17 census found none in live data; everything already
 * stores dates as ISO strings or epoch ms), `undefined` fields are dropped,
 * and anything with no JSON form is refused loudly rather than mangled.
 */
export function toStored(value: unknown, where = "value"): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${where}: ${value} cannot be stored`);
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (hasToDate(value)) return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map((v, i) => toStored(v === undefined ? null : v, `${where}[${i}]`));
    if (typeof value === "object") {
        if (sentinelOf(value)) throw new Error(`${where}: ${sentinelOf(value)!.kind} sentinel is not allowed here`);
        const out: DocData = {};
        for (const [k, v] of Object.entries(value as DocData)) {
            if (v === undefined) continue;
            out[k] = toStored(v, `${where}.${k}`);
        }
        return out;
    }
    throw new Error(`${where}: ${typeof value} cannot be stored`);
}

function applySentinel(sentinel: Sentinel, current: unknown, where: string): unknown | typeof REMOVE {
    switch (sentinel.kind) {
        case "delete":
            return REMOVE;
        case "increment":
            return typeof current === "number" ? current + sentinel.by : sentinel.by;
        case "unsupported":
            throw new Error(`${where}: ${sentinel.name} is not supported by the Postgres store`);
    }
}

const REMOVE = Symbol("remove");

/** `set(data)` with no options: the document becomes exactly `data`. */
export function replaceDoc(data: DocData): DocData {
    return mergeInto({}, data, "set");
}

/**
 * `set(data, { merge: true })`: nested maps merge key by key, everything else
 * (including arrays) is replaced, `FieldValue.delete()` removes the key.
 */
export function mergeDoc(existing: DocData | null, data: DocData): DocData {
    return mergeInto(structuredClone(existing ?? {}), data, "set");
}

function mergeInto(target: DocData, data: DocData, where: string): DocData {
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        const sentinel = sentinelOf(value);
        if (sentinel) {
            const next = applySentinel(sentinel, target[key], `${where}.${key}`);
            if (next === REMOVE) delete target[key];
            else target[key] = next;
        } else if (isPlainMap(value)) {
            const base = isPlainMap(target[key]) ? (target[key] as DocData) : {};
            target[key] = mergeInto(base, value, `${where}.${key}`);
        } else {
            target[key] = toStored(value, `${where}.${key}`);
        }
    }
    return target;
}

/**
 * `update(patch)`: each key is a field path ("a.b" addresses b inside map
 * a), its value replaces what is there (no deep merge), and sentinels apply
 * at that path.
 */
export function updateDoc(existing: DocData, patch: DocData): DocData {
    const out = structuredClone(existing);
    for (const [path, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const segments = path.split(".");
        let node: DocData = out;
        for (const segment of segments.slice(0, -1)) {
            if (!isPlainMap(node[segment])) node[segment] = {};
            node = node[segment] as DocData;
        }
        const leaf = segments[segments.length - 1];
        const sentinel = sentinelOf(value);
        if (sentinel) {
            const next = applySentinel(sentinel, node[leaf], `update.${path}`);
            if (next === REMOVE) delete node[leaf];
            else node[leaf] = next;
        } else {
            node[leaf] = isPlainMap(value) ? mergeInto({}, value, `update.${path}`) : toStored(value, `update.${path}`);
        }
    }
    return out;
}

/** Reads a field or dotted path; `undefined` means the field is absent. */
export function getField(data: DocData, path: string): unknown {
    let node: unknown = data;
    for (const segment of path.split(".")) {
        if (!isPlainMap(node) || !(segment in node)) return undefined;
        node = (node as DocData)[segment];
    }
    return node;
}

/** Firestore's cross-type order: null < boolean < number < string < array < map. */
function typeRank(value: unknown): number {
    if (value === null) return 0;
    if (typeof value === "boolean") return 1;
    if (typeof value === "number") return 2;
    if (typeof value === "string") return 4;
    if (Array.isArray(value)) return 8;
    return 9;
}

/** Strings compare by UTF-8 bytes, as Firestore does. */
export function compareValues(a: unknown, b: unknown): number {
    const ra = typeRank(a);
    const rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    if (typeof a === "boolean") return Number(a) - Number(b as boolean);
    if (typeof a === "number") {
        const nb = b as number;
        if (Number.isNaN(a)) return Number.isNaN(nb) ? 0 : -1;
        if (Number.isNaN(nb)) return 1;
        return a < nb ? -1 : a > nb ? 1 : 0;
    }
    if (typeof a === "string") return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b as string, "utf8"));
    if (Array.isArray(a)) {
        const bb = b as unknown[];
        for (let i = 0; i < Math.min(a.length, bb.length); i++) {
            const c = compareValues(a[i], bb[i]);
            if (c !== 0) return c;
        }
        return a.length - bb.length;
    }
    if (a === null) return 0;
    return compareValues(JSON.stringify(a), JSON.stringify(b));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
    return typeRank(a) === typeRank(b) && compareValues(a, b) === 0;
}

/** Whether one document matches one filter. `docId` answers DOC_ID filters. */
export function matches(data: DocData, docId: string, filter: Filter): boolean {
    const actual = filter.field === DOC_ID ? docId : getField(data, filter.field);
    if (actual === undefined) return false;
    const want = filter.value;
    switch (filter.op) {
        case "==":
            return valuesEqual(actual, want);
        case "!=":
            return actual !== null && !valuesEqual(actual, want);
        case "in":
            return Array.isArray(want) && want.some((w) => valuesEqual(actual, w));
        case "not-in":
            return actual !== null && Array.isArray(want) && !want.some((w) => valuesEqual(actual, w));
        case "array-contains":
            return Array.isArray(actual) && actual.some((a) => valuesEqual(a, want));
        case "array-contains-any":
            return Array.isArray(actual) && Array.isArray(want) && actual.some((a) => want.some((w) => valuesEqual(a, w)));
        case "<":
        case "<=":
        case ">":
        case ">=": {
            // Range filters only ever match values of the same type.
            if (typeRank(actual) !== typeRank(want)) return false;
            const c = compareValues(actual, want);
            return filter.op === "<" ? c < 0 : filter.op === "<=" ? c <= 0 : filter.op === ">" ? c > 0 : c >= 0;
        }
    }
}

export interface Candidate {
    id: string;
    /** The full document path, Firestore's final tie-break. */
    path: string;
    data: DocData;
}

/**
 * Applies filters, ordering and limit the way a Firestore query does:
 * documents missing an `orderBy` field are left out, ties fall back to the
 * document path, and with no `orderBy` results come in path order.
 */
export function runQuery<T extends Candidate>(rows: T[], filters: Filter[], orders: Order[], limit: number | null): T[] {
    let out = rows.filter((row) => filters.every((f) => matches(row.data, row.id, f)));
    out = out.filter((row) => orders.every((o) => o.field === DOC_ID || getField(row.data, o.field) !== undefined));
    const lastDir = orders.length ? orders[orders.length - 1].dir : "asc";
    out.sort((a, b) => {
        for (const o of orders) {
            const c =
                o.field === DOC_ID
                    ? compareValues(a.path, b.path)
                    : compareValues(getField(a.data, o.field), getField(b.data, o.field));
            if (c !== 0) return o.dir === "desc" ? -c : c;
        }
        const c = compareValues(a.path, b.path);
        return lastDir === "desc" ? -c : c;
    });
    return limit === null ? out : out.slice(0, limit);
}

/** `select(...fields)`: only the named fields (dotted paths allowed). */
export function project(data: DocData, fields: readonly string[]): DocData {
    const out: DocData = {};
    for (const field of fields) {
        const value = getField(data, field);
        if (value === undefined) continue;
        const segments = field.split(".");
        let node = out;
        for (const segment of segments.slice(0, -1)) {
            if (!isPlainMap(node[segment])) node[segment] = {};
            node = node[segment] as DocData;
        }
        node[segments[segments.length - 1]] = structuredClone(value);
    }
    return out;
}

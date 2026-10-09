/**
 * Shared by scripts/firestore-to-postgres.ts (copy) and
 * scripts/firestore-wipe.ts (delete): finding every Firestore document, and
 * checking that Postgres holds each one, sealed.
 *
 * "Every" means every: the manifest's collections, plus any root collection
 * or subcollection no code mentions any more, which goes to
 * intervu.legacy_docs (sealed, never read by the app) so the wipe can't
 * destroy data that was simply forgotten.
 */
import type { Firestore, DocumentSnapshot } from "firebase-admin/firestore";
import type { Pool } from "pg";

import { MIGRATION_MANIFEST, INTERVU_SCHEMA, type CollectionSpec } from "../../src/lib/db/firestore-migration-manifest";
import { layoutOf } from "../../src/lib/db/docstore/layout";
import type { Engine } from "../../src/lib/db/docstore/pg-docstore";
import { lookupHash } from "../../src/lib/db/docstore/seal";
import { toStored, type DocData } from "../../src/lib/db/docstore/values";

export const LEGACY_TABLE = `"${INTERVU_SCHEMA}"."legacy_docs"`;

/** Collections whose documents are known to have subcollections. Only
 *  these are walked document by document (the telemetry collections hold
 *  tens of thousands of childless documents). */
const PARENTS_WITH_SUBCOLLECTIONS = ["users", "profiles"];

const MANIFEST_IDS = new Set(MIGRATION_MANIFEST.map((s) => s.collection));

export interface SourceDoc {
    path: string;
    data: DocData;
}

export interface FirestoreInventory {
    /** Manifest collection id -> its documents. */
    known: Map<string, SourceDoc[]>;
    /** Documents in collections the manifest doesn't list. */
    legacy: SourceDoc[];
    /** Root collection ids Firestore reports. */
    roots: string[];
}

/** A Firestore document as JSON. Timestamps become ISO strings; GeoPoints,
 *  references and bytes (none exist per the 2026-08-17 census) are refused
 *  so nothing is silently reshaped. */
export function plainData(snap: DocumentSnapshot): DocData {
    const data = snap.data() ?? {};
    const reject = (v: unknown, where: string): void => {
        if (v === null || typeof v !== "object") return;
        const ctor = (v as object).constructor?.name;
        if (ctor === "GeoPoint" || ctor === "DocumentReference" || Buffer.isBuffer(v)) {
            throw new Error(`${snap.ref.path}: ${where} is a ${ctor ?? "Buffer"}, which has no agreed JSON form; convert it by hand first`);
        }
        if (Array.isArray(v)) v.forEach((x, i) => reject(x, `${where}[${i}]`));
        else if (ctor === "Object") for (const [k, x] of Object.entries(v)) reject(x, `${where}.${k}`);
    };
    reject(data, "document");
    return toStored(data, snap.ref.path) as DocData;
}

export async function inventoryFirestore(fs: Firestore, log: (line: string) => void): Promise<FirestoreInventory> {
    const known = new Map<string, SourceDoc[]>();
    for (const spec of MIGRATION_MANIFEST as readonly CollectionSpec[]) {
        const query = spec.subcollectionOf ? fs.collectionGroup(spec.collection) : fs.collection(spec.collection);
        const snap = await query.get();
        known.set(
            spec.collection,
            snap.docs.map((d) => ({ path: d.ref.path, data: plainData(d) })),
        );
    }

    const roots = (await fs.listCollections()).map((c) => c.id);
    const legacy: SourceDoc[] = [];
    for (const root of roots) {
        if (MANIFEST_IDS.has(root) || PARENTS_WITH_SUBCOLLECTIONS.includes(root)) continue;
        const snap = await fs.collection(root).get();
        log(`  not in the manifest: ${root} (${snap.size} documents) -> legacy_docs`);
        legacy.push(...snap.docs.map((d) => ({ path: d.ref.path, data: plainData(d) })));
    }

    for (const parent of PARENTS_WITH_SUBCOLLECTIONS) {
        if (!roots.includes(parent)) continue;
        const refs = await fs.collection(parent).listDocuments();
        for (const ref of refs) {
            if (!MANIFEST_IDS.has(parent)) {
                const own = await ref.get();
                if (own.exists) legacy.push({ path: own.ref.path, data: plainData(own) });
            }
            for (const sub of await ref.listCollections()) {
                if (MANIFEST_IDS.has(sub.id)) continue;
                const snap = await sub.get();
                log(`  not in the manifest: ${sub.path} (${snap.size} documents) -> legacy_docs`);
                legacy.push(...snap.docs.map((d) => ({ path: d.ref.path, data: plainData(d) })));
            }
        }
    }
    return { known, legacy, roots };
}

/** legacy_docs is keyed by a hash of the path, because a forgotten
 *  collection's ids may be emails. */
export function legacyKey(engine: Engine, path: string): string {
    return `legacy_docs/${lookupHash(engine.keys, path)}`;
}

/** Collections already live on Postgres through agent/store.ts's plain
 *  postgresStore (AGENT_PG_LIVE_COLLECTIONS): Postgres is their source of
 *  truth and their Firestore copies are stale, so they are resealed in place
 *  rather than copied, and not compared against Firestore. */
export function pgSourcedCollections(): Set<string> {
    return new Set(
        (process.env.AGENT_PG_LIVE_COLLECTIONS ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

export interface TableCheck {
    collection: string;
    firestore: number;
    postgres: number;
    unsealed: number;
    missing: string[];
    /** In Postgres but not Firestore: rows the app wrote after the switch,
     *  or leftovers the copy should have pruned. */
    extra: number;
}

/** Opens every row and compares real document paths with Firestore's. */
export async function checkTables(engine: Engine, pool: Pool, inv: FirestoreInventory): Promise<TableCheck[]> {
    const checks: TableCheck[] = [];
    const pgSourced = pgSourcedCollections();
    for (const [collection, docs] of inv.known) {
        const layout = layoutOf(collection);
        const { rows } = await pool.query<{ path: string; doc: DocData; sealed: string | null }>(
            `SELECT path, doc, sealed FROM ${engine.table(layout)}`,
        );
        const inPg = new Set<string>();
        let unsealed = 0;
        for (const row of rows) {
            if (row.sealed === null) unsealed++;
            inPg.add(engine.decode(row).path);
        }
        const inFs = new Set(docs.map((d) => d.path));
        if (pgSourced.has(collection)) {
            checks.push({ collection: `${collection} (pg)`, firestore: inFs.size, postgres: inPg.size, unsealed, missing: [], extra: 0 });
            continue;
        }
        checks.push({
            collection,
            firestore: inFs.size,
            postgres: inPg.size,
            unsealed,
            missing: [...inFs].filter((p) => !inPg.has(p)),
            extra: [...inPg].filter((p) => !inFs.has(p)).length,
        });
    }
    const legacy = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${LEGACY_TABLE}`);
    checks.push({
        collection: "(not in manifest)",
        firestore: inv.legacy.length,
        postgres: Number(legacy.rows[0].n),
        unsealed: 0,
        missing: [],
        extra: 0,
    });
    if (inv.legacy.length > Number(legacy.rows[0].n)) {
        checks[checks.length - 1].missing = [`${inv.legacy.length - Number(legacy.rows[0].n)} legacy documents`];
    }
    return checks;
}

export function printChecks(checks: TableCheck[], log: (line: string) => void): boolean {
    log(`${"collection".padEnd(24)} ${"firestore".padStart(9)} ${"postgres".padStart(9)} ${"unsealed".padStart(9)} ${"missing".padStart(8)} ${"extra".padStart(6)}`);
    let ok = true;
    for (const c of checks) {
        if (c.missing.length || c.unsealed) ok = false;
        log(
            `${c.collection.padEnd(24)} ${String(c.firestore).padStart(9)} ${String(c.postgres).padStart(9)} ${String(c.unsealed).padStart(9)} ${String(c.missing.length).padStart(8)} ${String(c.extra).padStart(6)}`,
        );
        for (const p of c.missing.slice(0, 5)) log(`    missing: ${p}`);
    }
    return ok;
}

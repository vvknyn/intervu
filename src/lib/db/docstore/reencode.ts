/**
 * Re-encode sealed rows whose readable `doc` no longer matches what the
 * CURRENT layout would store. A row keeps the lookup layout it was written
 * with, so changing a collection's owner field, indexed fields or hashed
 * fields (layout.ts / the manifest) leaves every existing row invisible to
 * queries on the new field until it is written again.
 *
 * Reuses the store's own encode (to detect drift) and its own read-then-set
 * (to repair it); no crypto or SQL encoding lives here.
 */
import { isDeepStrictEqual } from "node:util";

import { uidLabel as pathLabel } from "@/lib/account/orphan-accounts";
import { allLayouts, layoutOf, type CollectionLayout } from "./layout";
import { DocSnap, type PgDocDb } from "./pg-docstore";

const PAGE = 500;

export interface ReencodeReport {
    collection: string;
    scanned: number;
    drifted: number;
    rewritten: number;
    /** Drifted rows that were deleted between the scan and the write; nothing was written for them. */
    vanished: number;
    /** Rows that would not open: a sha256 label of the stored path (which can hold a uid) and the error name, never the message. */
    undecodable: { label: string; error: string }[];
}

/** Sealed rows have a `doc` holding only lookup fields; a row without `sealed` is a plain copy and is left alone. */
async function* sealedRows(db: PgDocDb, layout: CollectionLayout) {
    const { engine } = db;
    let after = "";
    for (;;) {
        const { rows } = await engine.pool.query(
            `SELECT path, doc, sealed FROM ${engine.table(layout)} WHERE path > $1 AND sealed IS NOT NULL ORDER BY path LIMIT ${PAGE}`,
            [after],
        );
        for (const row of rows) yield row;
        if (rows.length < PAGE) return;
        after = rows[rows.length - 1].path;
    }
}

export async function reencodeCollection(db: PgDocDb, collection: string, apply: boolean): Promise<ReencodeReport> {
    const layout = layoutOf(collection);
    const report: ReencodeReport = { collection, scanned: 0, drifted: 0, rewritten: 0, vanished: 0, undecodable: [] };
    for await (const row of sealedRows(db, layout)) {
        report.scanned++;
        let decoded: ReturnType<typeof db.engine.decode>;
        try {
            decoded = db.engine.decode(row);
        } catch (err) {
            report.undecodable.push({ label: pathLabel(row.path), error: err instanceof Error ? err.name : "unknown" });
            continue;
        }
        const { path, data } = decoded;
        if (isDeepStrictEqual(row.doc, JSON.parse(db.engine.encode(layout, path, data).doc))) continue;
        report.drifted++;
        if (!apply) continue;
        // The store's own read and write path, in one transaction so a concurrent update is never overwritten with stale data.
        const wrote = await db.runTransaction(async (tx) => {
            const ref = db.doc(path);
            const snap = await tx.get(ref);
            if (!(snap instanceof DocSnap) || !snap.exists) return false;
            tx.set(ref, snap.data()!);
            return true;
        });
        report[wrote ? "rewritten" : "vanished"]++;
    }
    return report;
}

export const allCollections = (): string[] => allLayouts().map((l) => l.spec.collection);

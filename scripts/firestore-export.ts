#!/usr/bin/env node
/**
 * Phase 1 of the Firestore -> Postgres migration: dump every collection in
 * MIGRATION_MANIFEST to CSV, one file per table, plus a checksum manifest.
 *
 *   npx tsx scripts/firestore-export.ts [--out=<dir>] [--collection=<id>]
 *
 * --collection scopes the run to one MIGRATION_MANIFEST entry (matched on
 * its `collection` id, e.g. `agent_credentials`) instead of all 26 — the
 * backfill for a single collection's cutover (see
 * src/lib/agent/store.ts's postgresStore()/getAgentStore()) without
 * re-exporting everyone else's data on every run.
 *
 * READ-ONLY against Firestore. It cannot delete or modify a document; the
 * migration is a COPY and the Firestore data stays exactly where it is until
 * a separate, explicitly approved cutover says otherwise.
 *
 * WHY A FILE IN THE MIDDLE. The db-box firewall admits ports 5432/6432/3000
 * only from the pipeline box, so no laptop can write to Postgres directly.
 * Exporting here, transferring, and loading there also means the dump is a
 * reviewable artifact and a point-in-time backup in its own right, rather
 * than a stream that has to be trusted while it runs.
 *
 * CSV, not NDJSON: `COPY ... FORMAT csv` has one unambiguous quoting rule
 * that both this writer and Postgres agree on, whereas COPY's default text
 * format assigns meaning to backslashes — which appear constantly inside
 * JSON string escapes.
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { MIGRATION_MANIFEST, type CollectionSpec } from "../src/lib/db/firestore-migration-manifest.ts";

// Env must land before firebase-admin is imported — it reads credentials at
// module init. Same manual .env.local read scripts/digest-dry-run.mts uses;
// this repo has no dotenv dependency in prod deps.
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

/**
 * Firestore's own value types have no JSON representation, so each is
 * converted explicitly and the conversion is COUNTED. A census on
 * 2026-08-17 found none of these in live data — this exists so that if that
 * ever stops being true the run says so out loud instead of quietly
 * serializing a Timestamp as `{"_seconds":…}` and calling it migrated.
 */
type Conversions = Map<string, number>;

function convert(value: unknown, seen: Conversions): unknown {
    if (value === null || value === undefined) return null;

    const ctor = (value as { constructor?: { name?: string } })?.constructor?.name;
    const note = (kind: string) => seen.set(kind, (seen.get(kind) ?? 0) + 1);

    if (ctor === "Timestamp") {
        note("Timestamp");
        return (value as { toDate(): Date }).toDate().toISOString();
    }
    if (ctor === "GeoPoint") {
        note("GeoPoint");
        const gp = value as { latitude: number; longitude: number };
        return { latitude: gp.latitude, longitude: gp.longitude };
    }
    if (ctor === "DocumentReference") {
        note("DocumentReference");
        return (value as { path: string }).path;
    }
    if (Buffer.isBuffer(value)) {
        note("Buffer");
        return (value as Buffer).toString("base64");
    }
    if (Array.isArray(value)) return value.map((v) => convert(v, seen));
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, convert(v, seen)]));
    }
    return value;
}

/** RFC 4180: wrap in quotes, double any embedded quote. Postgres `FORMAT
 *  csv` reads exactly this back. */
function csvField(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

interface TableReport {
    table: string;
    collection: string;
    rows: number;
    /** sha256 over the sorted document paths — proves every document
     *  arrived exactly once, and is comparable on the Postgres side without
     *  depending on how either engine happens to canonicalize JSON. */
    pathDigest: string;
    conversions: Record<string, number>;
}

async function main(): Promise<void> {
    const outArg = process.argv.find((a) => a.startsWith("--out="));
    const outDir = outArg ? outArg.slice("--out=".length) : "/tmp/firestore-export";
    mkdirSync(outDir, { recursive: true });

    const collectionArg = process.argv.find((a) => a.startsWith("--collection="));
    const wantedCollection = collectionArg ? collectionArg.slice("--collection=".length) : null;
    const specs = wantedCollection
        ? (MIGRATION_MANIFEST as CollectionSpec[]).filter((s) => s.collection === wantedCollection)
        : (MIGRATION_MANIFEST as CollectionSpec[]);
    if (wantedCollection && specs.length === 0) {
        console.error(`no collection '${wantedCollection}' in MIGRATION_MANIFEST`);
        process.exit(1);
    }

    const { getAdminDb } = await import("../src/lib/firebase/admin.ts");
    const db = getAdminDb();

    const reports: TableReport[] = [];

    for (const spec of specs) {
        // A subcollection has no single parent to read from, so it is walked
        // as a collection group; `doc.ref.path` carries the uid either way.
        const query = spec.subcollectionOf
            ? db.collectionGroup(spec.collection)
            : db.collection(spec.collection);

        const snap = await query.get();
        const conversions: Conversions = new Map();
        const paths: string[] = [];

        const file = join(outDir, `${spec.table}.csv`);
        const out = createWriteStream(file, { encoding: "utf8" });
        for (const doc of snap.docs) {
            const path = doc.ref.path;
            paths.push(path);
            const json = JSON.stringify(convert(doc.data(), conversions));
            out.write(`${csvField(path)},${csvField(json)}\n`);
        }
        await new Promise<void>((resolve, reject) => {
            out.on("error", reject);
            out.end(resolve);
        });

        paths.sort();
        const report: TableReport = {
            table: spec.table,
            collection: spec.collection,
            rows: paths.length,
            pathDigest: createHash("sha256").update(paths.join("\n")).digest("hex"),
            conversions: Object.fromEntries(conversions),
        };
        reports.push(report);

        const extra = Object.keys(report.conversions).length
            ? `  converted: ${JSON.stringify(report.conversions)}`
            : "";
        console.log(`${spec.table.padEnd(24)} ${String(report.rows).padStart(6)} rows${extra}`);
    }

    writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify({ tables: reports }, null, 2)}\n`);
    const total = reports.reduce((n, r) => n + r.rows, 0);
    console.log(`\n${reports.length} tables, ${total} documents -> ${outDir}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

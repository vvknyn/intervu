#!/usr/bin/env node
/**
 * Emits `deploy/db-box/intervu-schema.sql` from MIGRATION_MANIFEST.
 *
 * Generated rather than hand-written so the DDL cannot drift from the
 * exporter that fills it — both read the same manifest. The output IS
 * committed: the box applies a reviewed file, not whatever a script
 * happened to produce at deploy time.
 *
 *   npx tsx scripts/pg-generate-schema.ts
 *
 * Idempotent by construction (CREATE ... IF NOT EXISTS throughout), so it is
 * safe to re-apply. It deliberately contains no DROP: this schema holds
 * copied production user data and every row is historical.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
    INTERVU_SCHEMA,
    MIGRATION_MANIFEST,
    columnNameFor,
    generatedExpressionFor,
    type CollectionSpec,
} from "../src/lib/db/firestore-migration-manifest.ts";

const q = (ident: string) => `"${ident}"`;
const table = (spec: CollectionSpec) => `${q(INTERVU_SCHEMA)}.${q(spec.table)}`;

function ddlFor(spec: CollectionSpec): string {
    const lines: string[] = [];
    const cols: string[] = [
        // Globally unique and self-describing: a row always says which
        // Firestore document it came from.
        `    path        text PRIMARY KEY`,
        `    doc         jsonb NOT NULL`,
        // Provenance for re-runs; the copy is idempotent and this records
        // when a row was last refreshed, not when the document was created.
        `    copied_at   timestamptz NOT NULL DEFAULT now()`,
    ];

    if (spec.subcollectionOf) {
        // users/<uid>/<collection>/<docId> -> segment 2 is the uid. The uid
        // is not IN the document, so it is read back out of the path rather
        // than injected into the data during export.
        cols.push(`    uid         text GENERATED ALWAYS AS (split_part(path, '/', 2)) STORED`);
    }

    for (const field of spec.indexed) {
        cols.push(
            `    ${columnNameFor(field).padEnd(11)} ${field.type === "epoch_ms" ? "bigint" : "text"}` +
                ` GENERATED ALWAYS AS (${generatedExpressionFor(field)}) STORED`,
        );
    }

    lines.push(`CREATE TABLE IF NOT EXISTS ${table(spec)} (`);
    lines.push(cols.join(",\n"));
    lines.push(`);`);

    const indexTargets = [
        ...(spec.subcollectionOf ? [{ column: "uid", unique: false }] : []),
        ...spec.indexed.map((f) => ({ column: columnNameFor(f), unique: Boolean(f.unique) })),
    ];
    for (const target of indexTargets) {
        const name = `${spec.table}_${target.column}_idx`;
        lines.push(
            `CREATE ${target.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(name)}` +
                ` ON ${table(spec)} (${q(target.column)});`,
        );
    }

    return lines.join("\n");
}

const header = `-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/db/firestore-migration-manifest.ts
-- Regenerate: npx tsx scripts/pg-generate-schema.ts
--
-- Firestore -> Postgres, phase 1 (COPY, never move). Applying this file
-- creates empty tables and touches nothing that already exists; it contains
-- no DROP and no DELETE. Firebase Auth is unaffected — uid remains the key
-- and continues to come from Firebase.
--
-- Every table is: path (Firestore document path) as the primary key, doc
-- (the whole document) as jsonb, and generated columns derived from doc, so
-- an indexed column can never disagree with the document it came from.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ${q(INTERVU_SCHEMA)};
`;

const footer = `
-- Read/write access for the app. Reuses the roles the db-box already has
-- (deploy/db-box/setup.sh) rather than minting another: service_role is the
-- privileged writer, pipeline is the batch role. Default privileges cover
-- tables added by a later regeneration of this file.
GRANT USAGE ON SCHEMA ${q(INTERVU_SCHEMA)} TO service_role, pipeline;
GRANT ALL ON ALL TABLES IN SCHEMA ${q(INTERVU_SCHEMA)} TO service_role, pipeline;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${q(INTERVU_SCHEMA)}
    GRANT ALL ON TABLES TO service_role, pipeline;

COMMIT;
`;

const body = MIGRATION_MANIFEST.map(ddlFor).join("\n\n");
const sql = `${header}\n${body}\n${footer}`;

const here = __dirname;
const out = join(here, "..", "deploy", "db-box", "intervu-schema.sql");
writeFileSync(out, sql);
console.log(`wrote ${out} — ${MIGRATION_MANIFEST.length} tables`);

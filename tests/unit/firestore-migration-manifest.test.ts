import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    MIGRATION_MANIFEST,
    columnNameFor,
    generatedExpressionFor,
} from "@/lib/db/firestore-migration-manifest";

/** Columns every generated table already has (scripts/pg-generate-schema.ts). */
const RESERVED = ["path", "doc", "copied_at"];

describe("firestore migration manifest", () => {
    it("maps every collection to a distinct table", () => {
        const tables = MIGRATION_MANIFEST.map((s) => s.table);
        assert.equal(new Set(tables).size, tables.length, tables.join(", "));
    });

    it("maps every table from a distinct collection", () => {
        const collections = MIGRATION_MANIFEST.map((s) => `${s.subcollectionOf ?? ""}/${s.collection}`);
        assert.equal(new Set(collections).size, collections.length, collections.join(", "));
    });

    // The DDL writes `path`, `doc` and `copied_at` itself. A collection with
    // a field of one of those names would emit the column twice and the
    // whole schema file would fail to apply — after the earlier tables in
    // the same transaction had already been written.
    it("never promotes a field that collides with a reserved column", () => {
        for (const spec of MIGRATION_MANIFEST) {
            for (const field of spec.indexed) {
                assert.ok(
                    !RESERVED.includes(columnNameFor(field)),
                    `${spec.table}.${columnNameFor(field)} collides with a reserved column`,
                );
            }
        }
    });

    // A subcollection's uid column is generated from the path, so a document
    // field also named `uid` would be a duplicate column definition.
    it("never promotes a uid field on a subcollection, where uid comes from the path", () => {
        for (const spec of MIGRATION_MANIFEST.filter((s) => s.subcollectionOf)) {
            assert.ok(
                !spec.indexed.some((f) => columnNameFor(f) === "uid"),
                `${spec.table} would define uid twice`,
            );
        }
    });

    it("gives each table distinct column names", () => {
        for (const spec of MIGRATION_MANIFEST) {
            const cols = spec.indexed.map(columnNameFor);
            assert.equal(new Set(cols).size, cols.length, `${spec.table}: ${cols.join(", ")}`);
        }
    });

    /**
     * The immutability rule, pinned. A generated column's expression must be
     * IMMUTABLE, and casting text to `timestamptz`/`date`/`time` is only
     * STABLE — it reads the TimeZone setting — so Postgres rejects it
     * outright. `::bigint` is immutable, and ISO-8601-with-Z strings already
     * sort chronologically as text, which is why no date cast is needed.
     * A future field added with a temporal cast should fail here rather than
     * halfway through applying the schema.
     */
    it("emits only immutable expressions for generated columns", () => {
        for (const spec of MIGRATION_MANIFEST) {
            for (const field of spec.indexed) {
                const expr = generatedExpressionFor(field);
                assert.doesNotMatch(expr, /::\s*(timestamptz|timestamp|date|time)/i, `${spec.table}: ${expr}`);
                assert.match(expr, /^\(?doc->>'[^']+'\)?(::bigint)?$/, `${spec.table}: ${expr}`);
            }
        }
    });

    it("derives a column name from the field when none is given", () => {
        assert.equal(columnNameFor({ field: "user_id", type: "text" }), "user_id");
        assert.equal(columnNameFor({ field: "createdAt", type: "epoch_ms" }), "createdat");
        assert.equal(columnNameFor({ field: "createdAt", type: "epoch_ms", column: "created_at_ms" }), "created_at_ms");
    });

    // The three collections nothing has written to yet are exactly the ones
    // a cutover would break on first use, so their absence must be a test
    // failure rather than something noticed in production.
    it("covers the collections live code writes but which are still empty", () => {
        const tables = new Set(MIGRATION_MANIFEST.map((s) => s.table));
        for (const required of [
            "email_digest_state",
            "email_suppressions",
            "welcome_emails",
            "saved_searches",
            "followed_companies",
        ]) {
            assert.ok(tables.has(required), `manifest is missing ${required}`);
        }
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    MIGRATION_MANIFEST,
    NON_MIGRATED_COLLECTIONS,
    columnNameFor,
    generatedExpressionFor,
} from "@/lib/db/firestore-migration-manifest";
import { collectionsReferencedIn, scanFirestoreCollections } from "../support/firestore-collection-scan";

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

    // The manifest must cover every collection the code actually writes —
    // including the ones still empty, which are exactly the ones a cutover
    // breaks on first use. The required set is DERIVED from the source via
    // `scanFirestoreCollections`/`collectionsReferencedIn`
    // (tests/support/firestore-collection-scan.ts) rather than a remembered
    // name list — see that module's doc comment for the detector's history
    // and the gaps it closed.
    const collectionsInSource = scanFirestoreCollections();

    it("finds the collection references in src/", () => {
        assert.ok(
            collectionsInSource.size >= 15,
            `only found ${collectionsInSource.size} collection references — the scan is not reaching src/`,
        );
    });

    // A detector's silence is only meaningful if it also proves it can see. This
    // suite's own history is the counterexample: the 2026-08-18 gap above and the
    // named-constant gap this change fixes both shipped as a GREEN test, because a
    // regex that structurally cannot match a reference doesn't fail — it just never
    // adds the name to `found`, and an empty diff against the manifest reads as
    // "nothing left behind." It means only "nothing left behind among the references
    // I happened to match." Without this control, narrowing the regex to nothing
    // (or breaking it outright) would silently turn every future miss invisible
    // again. Pinned against `welcome_emails` — already migrated, so this assertion
    // can never pass by coincidence of an open failure list.
    it("CONTROL: resolves a same-file named constant, not just an inline literal", () => {
        const path = join(process.cwd(), "src/lib/email/welcome.ts");
        const src = readFileSync(path, "utf8");
        assert.ok(
            collectionsReferencedIn(src, path).has("welcome_emails"),
            "collectionsReferencedIn no longer resolves `const COLLECTION = \"...\"` passed to .collection(COLLECTION)",
        );
    });

    // Same defect one level down: the widened detector still hardcoded the double
    // quote in both regexes, so `.collection('x')`, `` .collection(`x`) ``,
    // `const C = 'x'` and `` const C = `x` `` were all as invisible as the plain
    // inline literal was before the fix above. Nothing in this repo's tooling stops
    // a single-quoted string from landing (src/types/resume.ts:11-12 already uses
    // single quotes elsewhere, and no prettier/eslint rule here enforces double
    // quotes) — the corpus just doesn't happen to spell a collection name that way
    // yet, which is exactly the kind of latent gap a corpus-only test can't cover.
    // Exercise `collectionsReferencedIn` directly on synthetic source instead.
    it("CONTROL: resolves single-quote and backtick spellings, both inline and named", () => {
        assert.ok(
            collectionsReferencedIn(`db.collection('single_inline')`, "synthetic.ts").has("single_inline"),
            "single-quoted inline literal argument not resolved",
        );
        assert.ok(
            collectionsReferencedIn("db.collection(`backtick_inline`)", "synthetic.ts").has("backtick_inline"),
            "backtick-quoted inline literal argument not resolved",
        );
        assert.ok(
            collectionsReferencedIn(`const COLLECTION = 'single_named';\ndb.collection(COLLECTION);`, "synthetic.ts").has(
                "single_named",
            ),
            "single-quoted named-constant assignment not resolved",
        );
        assert.ok(
            collectionsReferencedIn(
                "const COLLECTION = `backtick_named`;\ndb.collection(COLLECTION);",
                "synthetic.ts",
            ).has("backtick_named"),
            "backtick-quoted named-constant assignment not resolved",
        );
    });

    // The blind spot this suite documented at the top (`source.collection` in
    // admin/metrics.ts) turned out to be a real miss, not a correct-by-construction
    // case: `source` there is a `{ collection: "waitlist" }` object literal built in
    // the same file, not a MIGRATION_MANIFEST lookup. Pinned against the real file so
    // a future refactor that moves the registry elsewhere fails this test rather than
    // silently going dark again.
    it("CONTROL: resolves a config literal read through a dynamic .collection(x.collection) call", () => {
        const path = join(process.cwd(), "src/lib/admin/metrics.ts");
        const src = readFileSync(path, "utf8");
        const found = collectionsReferencedIn(src, path);
        assert.ok(found.has("waitlist"), "collectionsReferencedIn no longer resolves the waitlist config literal");
        assert.ok(
            found.has("credit_grants"),
            "collectionsReferencedIn no longer resolves the credit_grants config literal",
        );
    });

    // The resolution above is gated on the file actually containing a dynamic
    // `.collection(‹expr›.collection)` call — without that gate, any unrelated object
    // that merely happens to have a `collection: "..."` field (a UI option list, a
    // fixture) would be reported as a Firestore reference. Prove the gate holds: the
    // same literal, with no dynamic call anywhere in the source, resolves to nothing.
    it("CONTROL: a collection: literal with no dynamic .collection call in the file is not a reference", () => {
        const found = collectionsReferencedIn(
            `const options = [{ collection: "not_a_firestore_reference" }];`,
            "synthetic.ts",
        );
        assert.equal(found.size, 0, `expected no references, found: ${[...found].join(", ")}`);
    });

    // Proves the backreference actually binds the opening and closing quote
    // together rather than accepting either end independently — a regex that let
    // them mismatch could resolve the literal quote character itself as a
    // "collection name" and still look green.
    it("CONTROL: a mismatched open/close quote is not reported as a collection", () => {
        const found = collectionsReferencedIn('db.collection("foo`)', "synthetic.ts");
        assert.equal(found.size, 0, `mismatched-quote call should match nothing, found: ${[...found].join(", ")}`);
    });

    // The class this session's coordinator asked for: `agent/store.ts` and
    // `db/user-data.ts` also trip the dynamic gate and harvest zero local literals,
    // and that is fine — but only because both import MIGRATION_MANIFEST and can
    // therefore never name a collection outside it. A file with neither a local
    // literal nor a manifest import is a real blind spot and must fail loudly rather
    // than silently reporting nothing.
    it("CONTROL: throws when a dynamic .collection call has neither a local literal nor a MIGRATION_MANIFEST import", () => {
        assert.throws(
            () => collectionsReferencedIn(`function probe(x) { return db.collection(x.collection); }`, "synthetic.ts"),
            /synthetic\.ts/,
            "collectionsReferencedIn did not fail loudly for an unaccounted dynamic .collection call",
        );
    });

    it("CONTROL: does not throw when the dynamic call is accounted for by a local literal or a manifest import", () => {
        assert.doesNotThrow(() =>
            collectionsReferencedIn(
                `function probe(x) { return db.collection(x.collection); }\n` +
                    `const specs = [{ collection: "accounted_for" }];`,
                "synthetic.ts",
            ),
        );
        assert.doesNotThrow(() =>
            collectionsReferencedIn(
                `import { MIGRATION_MANIFEST } from "./firestore-migration-manifest";\n` +
                    `function probe(x) { return db.collection(x.collection); }`,
                "synthetic.ts",
            ),
        );
    });

    it("migrates every collection the code writes, or excludes it on purpose", () => {
        const migrated = new Set(MIGRATION_MANIFEST.map((s) => s.collection));
        const missing = [...collectionsInSource].filter(
            (c) => !migrated.has(c) && !(c in NON_MIGRATED_COLLECTIONS),
        );
        assert.deepEqual(
            missing,
            [],
            `these collections are written by src/ but neither migrated nor excluded: ${missing.join(", ")}. ` +
                `Add them to MIGRATION_MANIFEST, or to NON_MIGRATED_COLLECTIONS with a reason.`,
        );
    });

    it("does not carry exclusions for collections nothing references", () => {
        for (const name of Object.keys(NON_MIGRATED_COLLECTIONS)) {
            assert.ok(
                collectionsInSource.has(name),
                `${name} is excluded but no longer referenced in src/ — drop the exclusion`,
            );
        }
    });
});

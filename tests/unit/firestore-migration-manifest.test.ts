import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
    MIGRATION_MANIFEST,
    NON_MIGRATED_COLLECTIONS,
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

    /**
     * The manifest must cover every collection the code actually writes —
     * including the ones still empty, which are exactly the ones a cutover
     * breaks on first use.
     *
     * This used to enumerate five table names by hand. That is the failure
     * mode it now exists to prevent: on 2026-08-18 SEVEN collections written
     * by live code (`resume_history`, `stories`, `sources`,
     * `favorite_questions`, `interview_questions`, `feedback`,
     * `connect_waitlist`) were found outside the manifest, because a guard
     * that checks remembered names can only ever check remembered names.
     * The required set is now DERIVED from the source.
     *
     * That derivation still had a gap: it only matched a string literal sitting
     * directly inside the call, so `const COLLECTION = "follow_funnel_events"` two
     * lines above `.collection(COLLECTION)` (src/lib/follows/funnel-log.ts) was
     * invisible to it — same idiom as welcome.ts, digest-cursor.ts, suppression.ts,
     * daily-snapshot.ts and account-email.ts. `collectionsReferencedIn` now also
     * resolves one hop: a bare identifier argument to a `const`/`let`/`var` in the
     * same file assigned a string literal. It deliberately goes no further —
     * `source.collection` (admin/metrics.ts), `collection(col)` (agent/store.ts) and
     * `.collection(q.collection)` (db/user-data.ts) all take their collection name
     * from MIGRATION_MANIFEST-derived data at runtime, so there is no literal in the
     * file to resolve them to; they are correct by construction, not a second gap to
     * paper over by guessing.
     *
     * Both regexes also accept any of the three JS quote characters (`"`, `'`, `` ` ``)
     * via a capture group plus a backreference, not just the double quote — the same
     * "one spelling only" defect one level down. Nothing in this repo enforces double
     * quotes (no prettier/eslint rule does), so a single-quoted or template-literal
     * collection constant is a live possibility even though none exists in src/ today.
     */
    function collectionsReferencedIn(src: string): Set<string> {
        const found = new Set<string>();
        const call =
            /\.(?:collection|collectionGroup)\(\s*(?:(["'`])([A-Za-z_][A-Za-z0-9_]*)\1|([A-Za-z_][A-Za-z0-9_]*))\s*\)/g;
        const idents: string[] = [];
        for (const m of src.matchAll(call)) {
            if (m[2]) found.add(m[2]);
            else idents.push(m[3]);
        }
        if (idents.length > 0) {
            const consts = new Map<string, string>();
            const assignment =
                /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'`])([A-Za-z_][A-Za-z0-9_]*)\2/g;
            for (const m of src.matchAll(assignment)) consts.set(m[1], m[3]);
            for (const ident of idents) {
                const resolved = consts.get(ident);
                if (resolved) found.add(resolved);
            }
        }
        return found;
    }

    const collectionsInSource = (() => {
        const found = new Set<string>();
        (function walk(dir: string) {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (/\.tsx?$/.test(entry)) {
                    const src = readFileSync(full, "utf8");
                    for (const name of collectionsReferencedIn(src)) found.add(name);
                }
            }
        })(join(process.cwd(), "src"));
        return found;
    })();

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
        const src = readFileSync(join(process.cwd(), "src/lib/email/welcome.ts"), "utf8");
        assert.ok(
            collectionsReferencedIn(src).has("welcome_emails"),
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
            collectionsReferencedIn(`db.collection('single_inline')`).has("single_inline"),
            "single-quoted inline literal argument not resolved",
        );
        assert.ok(
            collectionsReferencedIn("db.collection(`backtick_inline`)").has("backtick_inline"),
            "backtick-quoted inline literal argument not resolved",
        );
        assert.ok(
            collectionsReferencedIn(`const COLLECTION = 'single_named';\ndb.collection(COLLECTION);`).has(
                "single_named",
            ),
            "single-quoted named-constant assignment not resolved",
        );
        assert.ok(
            collectionsReferencedIn("const COLLECTION = `backtick_named`;\ndb.collection(COLLECTION);").has(
                "backtick_named",
            ),
            "backtick-quoted named-constant assignment not resolved",
        );
    });

    // Proves the backreference actually binds the opening and closing quote
    // together rather than accepting either end independently — a regex that let
    // them mismatch could resolve the literal quote character itself as a
    // "collection name" and still look green.
    it("CONTROL: a mismatched open/close quote is not reported as a collection", () => {
        const found = collectionsReferencedIn('db.collection("foo`)');
        assert.equal(found.size, 0, `mismatched-quote call should match nothing, found: ${[...found].join(", ")}`);
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

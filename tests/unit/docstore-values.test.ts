import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FieldValue } from "firebase-admin/firestore";

import { deriveDocKeys, lookupHash, open, seal } from "../../src/lib/db/docstore/seal";
import { mergeDoc, matches, project, replaceDoc, runQuery, updateDoc, DOC_ID } from "../../src/lib/db/docstore/values";
import { allLayouts } from "../../src/lib/db/docstore/layout";
import { MIGRATION_MANIFEST } from "../../src/lib/db/firestore-migration-manifest";

const KEY_A = "11".repeat(32);
const KEY_B = "22".repeat(32);

describe("seal", () => {
    const keys = deriveDocKeys(KEY_A);

    it("round-trips a document and never stores it readable", () => {
        const doc = { resume_text: "Maya Okonkwo, RN, 8 years ICU", n: 3 };
        const sealed = seal(keys, "profiles/u1", doc);
        assert.ok(!sealed.includes("Maya"));
        assert.deepEqual(open(keys, "profiles/u1", sealed), doc);
    });

    it("refuses a blob moved to another row, or opened with another key", () => {
        const sealed = seal(keys, "profiles/u1", { a: 1 });
        assert.throws(() => open(keys, "profiles/u2", sealed));
        assert.throws(() => open(deriveDocKeys(KEY_B), "profiles/u1", sealed));
    });

    it("hashes lookups by value and type, and per key", () => {
        assert.equal(lookupHash(keys, "a@b.co"), lookupHash(keys, "a@b.co"));
        assert.notEqual(lookupHash(keys, "1"), lookupHash(keys, 1));
        assert.notEqual(lookupHash(keys, "a@b.co"), lookupHash(deriveDocKeys(KEY_B), "a@b.co"));
        assert.ok(!lookupHash(keys, "a@b.co").includes("a@b.co"));
    });

    it("rejects a malformed root key", () => {
        assert.throws(() => deriveDocKeys("abc"), /64 hex/);
    });
});

describe("Firestore write semantics", () => {
    it("set with merge merges nested maps, replaces arrays, applies delete and increment", () => {
        const existing = { a: { x: 1, y: 2 }, list: [1, 2], gone: true, n: 4 };
        const next = mergeDoc(existing, {
            a: { y: 3, z: 4 },
            list: [9],
            gone: FieldValue.delete(),
            n: FieldValue.increment(2),
            fresh: FieldValue.increment(5),
        });
        assert.deepEqual(next, { a: { x: 1, y: 3, z: 4 }, list: [9], n: 6, fresh: 5 });
        assert.deepEqual(existing.a, { x: 1, y: 2 }, "input untouched");
    });

    it("update reads dotted keys as paths and replaces maps whole", () => {
        const next = updateDoc(
            { entries: { digest: "x", follow: "y" }, profile: { a: 1, b: 2 } },
            { "entries.digest": FieldValue.delete(), profile: { c: 3 }, "deep.new.leaf": 1 },
        );
        assert.deepEqual(next, { entries: { follow: "y" }, profile: { c: 3 }, deep: { new: { leaf: 1 } } });
    });

    it("plain set replaces the document and stores dates as ISO strings", () => {
        const at = new Date("2026-10-08T00:00:00.000Z");
        assert.deepEqual(replaceDoc({ at, skip: undefined, n: 1 }), { at: at.toISOString(), n: 1 });
    });
});

describe("Firestore query semantics", () => {
    const rows = [
        { id: "a", path: "c/a", data: { t: "2026-01-02", n: 2, s: "x" } },
        { id: "b", path: "c/b", data: { t: "2026-01-01", n: "2" } },
        { id: "c", path: "c/c", data: { n: 10 } },
        { id: "d", path: "c/d", data: { t: "2026-01-02", n: 1 } },
    ];

    it("range filters only match values of the same type", () => {
        assert.deepEqual(
            rows.filter((r) => matches(r.data, r.id, { field: "n", op: ">", value: 1 })).map((r) => r.id),
            ["a", "c"],
        );
        assert.equal(matches({ n: 2 }, "a", { field: "n", op: "==", value: "2" }), false);
    });

    it("orderBy drops documents missing the field and breaks ties by path", () => {
        assert.deepEqual(runQuery(rows, [], [{ field: "t", dir: "desc" }], null).map((r) => r.id), ["d", "a", "b"]);
        assert.deepEqual(runQuery(rows, [], [{ field: "t", dir: "asc" }], 2).map((r) => r.id), ["b", "a"]);
    });

    it("filters on the document id", () => {
        assert.deepEqual(
            runQuery(rows, [{ field: DOC_ID, op: "in", value: ["b", "d", "z"] }], [], null).map((r) => r.id),
            ["b", "d"],
        );
    });

    it("select keeps only the named fields", () => {
        assert.deepEqual(project({ a: 1, b: { c: 2, d: 3 } }, ["b.c"]), { b: { c: 2 } });
        assert.deepEqual(project({ a: 1 }, []), {});
    });
});

describe("what stays readable in Postgres", () => {
    it("no personal field is ever kept in the clear", () => {
        const personal = /email|name|phone|resume|text|content|question|answer|note|company|position|title|query|^q$/i;
        for (const layout of allLayouts()) {
            for (const field of layout.readable) {
                assert.ok(
                    !personal.test(field),
                    `${layout.spec.collection}.${field} would be stored readable; hash it in LOOKUP_RULES or leave it sealed`,
                );
            }
        }
    });

    it("every manifest table, and legacy_docs, is granted to the app role", () => {
        const sql = readFileSync(join(__dirname, "../../deploy/db-box/data-store-role.sql"), "utf8");
        for (const table of [...MIGRATION_MANIFEST.map((s) => s.table), "legacy_docs"]) {
            assert.ok(sql.includes(`'${table}'`), `${table} missing from data-store-role.sql`);
        }
    });
});

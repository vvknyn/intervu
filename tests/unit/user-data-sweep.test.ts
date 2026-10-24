import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATION_MANIFEST } from "@/lib/db/firestore-migration-manifest";
import { PG_USER_KEYED_TABLES, TELEMETRY_USER_TABLE, USER_OWNED_COLLECTIONS, userDataPlan } from "@/lib/db/user-data";

const UID = "TESTuid000000000000000000000";
const plan = userDataPlan(UID);
const byTable = new Map(plan.map((r) => [r.table, r.query]));

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("user data sweep", () => {
    // The defect this suite exists for. `resume_history` lives at
    // profiles/<uid>/resume_history and carries no user_id field, so a sweep
    // that queries top-level collections by user_id cannot see it. Closing an
    // account left every saved resume version in place, and on 2026-08-18 six
    // of the eight uids owning one had no Auth account left.
    it("reaches resume_history under the profiles parent", () => {
        assert.deepEqual(byTable.get("resume_history"), {
            kind: "subcollection",
            parent: "profiles",
            uid: UID,
            collection: "resume_history",
        });
    });

    it("reaches both users/<uid> subcollections", () => {
        for (const table of ["saved_searches", "followed_companies"]) {
            const q = byTable.get(table);
            assert.equal(q?.kind, "subcollection", table);
            assert.equal(q?.kind === "subcollection" && q.parent, "users", table);
        }
    });

    // A credential that outlives its account is a token nobody can revoke.
    it("reaches every agent credential and pairing code", () => {
        for (const table of ["agent_credentials", "agent_codes"]) {
            assert.deepEqual(byTable.get(table), {
                kind: "field",
                collection: table,
                field: "uid",
                uid: UID,
            });
        }
    });

    // apply_counters keys documents `<uid>_<date>`, so it needs a range scan.
    // An empty range end collapses `>= x AND < x` to a query matching nothing
    // and reporting it as "this user owns none" — a silent miss, not an error.
    it("scans a non-empty range for uid-prefixed document ids", () => {
        const q = byTable.get("apply_counters");
        assert.equal(q?.kind, "docIdPrefix");
        assert.ok(q?.kind === "docIdPrefix" && q.separator.length > 0, "separator must be non-empty");
        const src = read("src/lib/db/user-data.ts");
        const rangeEnd = /const PREFIX_RANGE_END = "([^"]*)"/.exec(src);
        assert.ok(rangeEnd, "PREFIX_RANGE_END must exist");
        assert.notEqual(rangeEnd[1], "", "an empty range end matches nothing");
    });

    // Coverage is the whole point: one read per user-owned collection, so a
    // collection added to the manifest is swept without anyone editing a list.
    it("plans exactly one read per user-owned collection", () => {
        assert.equal(plan.length, USER_OWNED_COLLECTIONS.length);
        assert.deepEqual(
            [...byTable.keys()].sort(),
            USER_OWNED_COLLECTIONS.map((s) => s.table).sort()
        );
        assert.ok(plan.length >= 12, `only ${plan.length} collections planned — suspiciously few`);
    });

    it("plans no read for a collection declared not user-owned", () => {
        const excluded = MIGRATION_MANIFEST.filter((s) => s.owner.by === "none").map((s) => s.table);
        assert.ok(excluded.length > 0, "guard is vacuous if nothing is excluded");
        for (const table of excluded) assert.equal(byTable.has(table), false, table);
    });

    // `by: "none"` is the one escape hatch. Requiring a reason keeps it a
    // decision on the record rather than an omission that looks like one.
    it("makes every exclusion state a reason", () => {
        for (const spec of MIGRATION_MANIFEST) {
            if (spec.owner.by === "none") {
                assert.ok(spec.owner.reason.length > 10, `${spec.collection}: reason too thin`);
            }
        }
    });

    // The root cause was a literal list of collection names in the action
    // file. Three of them existed at once and all three had drifted. This
    // fails if one comes back, without naming the collections it may contain.
    it("keeps the account actions free of hand-typed collection lists", () => {
        const names = new Set(MIGRATION_MANIFEST.flatMap((s) => [s.collection, s.table]));
        for (const file of ["src/actions/auth.ts", "src/actions/account.ts"]) {
            const src = read(file);
            for (const [, body] of src.matchAll(/\[([^[\]]*)\]/g)) {
                const literals = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
                const known = literals.filter((l) => names.has(l));
                assert.ok(
                    known.length < 3,
                    `${file} enumerates collections [${known.join(", ")}] — derive them from MIGRATION_MANIFEST instead`
                );
            }
        }
    });

    it("has exactly one deleteAccount implementation", () => {
        const defs = ["src/actions/auth.ts", "src/actions/account.ts"].filter((f) =>
            /export async function deleteAccount\b/.test(read(f))
        );
        assert.deepEqual(defs, ["src/actions/auth.ts"]);
    });

    // Firestore first, Auth last: once the Auth user is gone a failed sweep
    // can never be retried, because nobody can sign in as them again. The
    // order itself is tested on eraseAccount (erase-account.test.ts); this
    // pins that deleteAccount goes through it with the manifest sweep.
    it("deletes the Auth user only through eraseAccount, after the sweep", () => {
        const src = read("src/actions/auth.ts");
        const body = src.slice(src.indexOf("export async function deleteAccount"));
        assert.match(body, /eraseAccount\(/);
        assert.match(body, /storeEraseDeps\(db\)/);
        assert.match(read("src/lib/account/erase-account.ts"), /runUserDataPlan\(uid, db\)/);
    });
});

/** Tables in a .sql file that have a column holding a user id, found by
 *  reading the schema — not from any list kept in code. */
function userKeyedTables(file: string): string[] {
    const sql = read(file).replace(/--.*$/gm, "");
    const found: string[] = [];
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:"?intervu"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
        if (/^\s*"?(user_uid|user_id|uid)"?\s/m.test(m[2])) found.push(m[1]);
    }
    return found;
}

describe("erase registry covers every user-keyed table in the schema", () => {
    const owned = new Set(USER_OWNED_COLLECTIONS.map((c) => c.table));
    const direct = new Set(PG_USER_KEYED_TABLES.map((t) => t.table));

    it("the schema files really are being parsed", () => {
        assert.ok(userKeyedTables("deploy/supabase/identity-schema.sql").includes("resume_parse_counters"));
        assert.ok(userKeyedTables("deploy/db-box/intervu-schema.sql").includes("applications"));
    });

    it("every docstore table with a user column is a user-owned manifest collection", () => {
        for (const table of userKeyedTables("deploy/db-box/intervu-schema.sql")) {
            assert.ok(owned.has(table), `${table} has a user column but the manifest marks it unowned`);
        }
    });

    it("every hand-written intervu table with a user column is in PG_USER_KEYED_TABLES", () => {
        for (const table of userKeyedTables("deploy/supabase/identity-schema.sql")) {
            assert.ok(direct.has(table), `${table} has a user column but deletePgUserRows would skip it`);
        }
    });

    it("every telemetry table with a user column is erased (the ledger via forget_telemetry_user)", () => {
        for (const file of ["telemetry-schema.sql", "telemetry-derived.sql"]) {
            for (const table of userKeyedTables(`deploy/db-box/${file}`)) {
                assert.equal(table, TELEMETRY_USER_TABLE, `${table} in ${file} has no erase path`);
            }
        }
    });

    it("registry entries name a real table and column", () => {
        const sql = read("deploy/supabase/identity-schema.sql");
        for (const { table, column } of PG_USER_KEYED_TABLES) {
            assert.match(sql, new RegExp(`intervu\\.${table}\\s*\\([\\s\\S]*?\\n\\s*${column}\\s`), table);
        }
    });
});

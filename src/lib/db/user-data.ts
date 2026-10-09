/**
 * Everything one person owns, resolved from the migration manifest instead of
 * from a list someone maintains by hand.
 *
 * WHY THIS EXISTS. Account deletion and the "export my data" action both need
 * the same answer to the same question — which documents belong to this uid —
 * and before this module each answered it with its own literal array of
 * collection names. The two arrays had already drifted from each other and
 * both had drifted from reality: closing an account left `resume_history`
 * (every saved resume version, the most personal data in the product), both
 * `users/<uid>` subcollections and every `agent_*` credential in place, and
 * the export omitted `resume_history` too. On 2026-08-18 six of the eight uids
 * with saved resumes had no Firebase Auth account left, so that data was
 * already outliving the people it described.
 *
 * The planner below is pure: uid in, a description of the reads out. Nothing
 * here touches Firestore, so the coverage guarantee — one query for every
 * collection the manifest calls user-owned — is a unit test rather than a
 * hope. `runUserDataPlan` is the thin I/O half.
 */
import { type Firestore, FieldPath } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { MIGRATION_MANIFEST, type CollectionSpec } from "./firestore-migration-manifest";

/** A single read to make against Firestore, described but not performed. */
export type UserDataQuery =
    | { kind: "field"; collection: string; field: string; uid: string }
    | { kind: "subcollection"; parent: string; uid: string; collection: string }
    | { kind: "docId"; collection: string; uid: string }
    | { kind: "docIdPrefix"; collection: string; uid: string; separator: string };

export interface UserDataRead {
    /** Postgres table name from the manifest — the stable key both callers
     *  bucket by, so the export's shape does not depend on Firestore ids. */
    table: string;
    query: UserDataQuery;
}

/** The manifest entries that describe data belonging to a person. */
export const USER_OWNED_COLLECTIONS: readonly CollectionSpec[] = MIGRATION_MANIFEST.filter(
    (spec) => spec.owner.by !== "none"
);

/**
 * Every read needed to find one user's documents — one per user-owned
 * collection, no more and no fewer. Adding a user-owned collection to the
 * manifest extends this by construction; there is no name to remember.
 */
export function userDataPlan(uid: string): UserDataRead[] {
    return USER_OWNED_COLLECTIONS.map((spec) => ({ table: spec.table, query: queryFor(spec, uid) }));
}

function queryFor(spec: CollectionSpec, uid: string): UserDataQuery {
    const owner = spec.owner;
    switch (owner.by) {
        case "field":
            return { kind: "field", collection: spec.collection, field: owner.field, uid };
        case "path":
            if (!spec.subcollectionOf) {
                // Fail loudly: a path-owned collection with no parent named
                // would silently resolve to zero documents, which reads as
                // "this user has none" rather than "we cannot look".
                throw new Error(`${spec.collection}: owner.by "path" requires subcollectionOf`);
            }
            return { kind: "subcollection", parent: spec.subcollectionOf, uid, collection: spec.collection };
        case "docId":
            return { kind: "docId", collection: spec.collection, uid };
        case "docIdPrefix":
            return { kind: "docIdPrefix", collection: spec.collection, uid, separator: owner.separator };
        case "none":
            throw new Error(`${spec.collection}: not user-owned`);
    }
}

/** One document found for a user, identified by its full Firestore path. */
export interface FoundDoc {
    path: string;
    id: string;
    data: Record<string, unknown>;
}

/** A code point above every character Firestore puts in a document id, so
 *  the half-open range [uid+sep, uid+sep+END) covers exactly the ids
 *  beginning with that prefix, with no suffix enumerated. It MUST be
 *  non-empty: an empty range end collapses it to `>= x AND < x`,
 *  which matches nothing and reports it as 'this user has none'. */
const PREFIX_RANGE_END = "\uf8ff";

async function runQuery(db: Firestore, q: UserDataQuery): Promise<FoundDoc[]> {
    const toDocs = (snap: FirebaseFirestore.QuerySnapshot): FoundDoc[] =>
        snap.docs.map((d) => ({ path: d.ref.path, id: d.id, data: d.data() }));

    switch (q.kind) {
        case "field":
            return toDocs(await db.collection(q.collection).where(q.field, "==", q.uid).get());
        case "subcollection":
            // Queried under the known parent rather than as a collection
            // group: the parent document may not exist (Firestore keeps
            // subcollections of a deleted or never-created parent), but the
            // subcollection under its path is still readable.
            return toDocs(await db.collection(q.parent).doc(q.uid).collection(q.collection).get());
        case "docId": {
            const doc = await db.collection(q.collection).doc(q.uid).get();
            return doc.exists ? [{ path: doc.ref.path, id: doc.id, data: doc.data() ?? {} }] : [];
        }
        case "docIdPrefix": {
            const start = q.uid + q.separator;
            return toDocs(
                await db
                    .collection(q.collection)
                    .where(FieldPath.documentId(), ">=", start)
                    .where(FieldPath.documentId(), "<", start + PREFIX_RANGE_END)
                    .get()
            );
        }
    }
}

/** Run the whole plan and bucket the results by manifest table name. */
export async function runUserDataPlan(
    uid: string,
    db: Firestore = getAdminDb()
): Promise<Record<string, FoundDoc[]>> {
    const reads = userDataPlan(uid);
    const results = await Promise.all(reads.map((r) => runQuery(db, r.query)));
    return Object.fromEntries(reads.map((r, i) => [r.table, results[i]]));
}

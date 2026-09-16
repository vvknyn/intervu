import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { MIGRATION_MANIFEST } from "../../src/lib/db/firestore-migration-manifest";

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
 * same file assigned a string literal. It deliberately goes no further for a
 * bare identifier — `collection(col)` (agent/store.ts) and `.collection(q.collection)`
 * (db/user-data.ts) both take their collection name from MIGRATION_MANIFEST-derived
 * data at runtime, so there is no literal anywhere in the file to resolve them to;
 * they are correct by construction, not a second gap to paper over by guessing.
 *
 * `source.collection` (admin/metrics.ts:95) looked like the same case and wasn't:
 * `source` is not a manifest lookup, it's a per-call `{ collection: "waitlist" }` /
 * `{ collection: "credit_grants" }` object literal built right there in the same
 * file's `METRICS` registry (metrics.ts:224-390) and threaded through `queryFor`.
 * The literal exists; it just sits behind a property read instead of a bare name.
 * So `collectionsReferencedIn` also matches `.collection(‹expr›.collection)` /
 * `.collectionGroup(‹expr›.collection)` — the argument reading a property literally
 * named `collection`, the same name as the method, which is what makes this a
 * config object feeding a dynamic call rather than an arbitrary member access — and
 * when that shape is present, resolves every `collection: "literal"` object-literal
 * property in the same file. This is what caught `credit_grants` and `waitlist`
 * being missing from the manifest: they were never invisible for lack of a literal,
 * only for lack of a detector that read one hop through a property instead of a
 * bare identifier.
 *
 * All three regexes also accept any of the three JS quote characters (`"`, `'`,
 * `` ` ``) via a capture group plus a backreference, not just the double quote —
 * the same "one spelling only" defect one level down. Nothing in this repo enforces
 * double quotes (no prettier/eslint rule does), so a single-quoted or
 * template-literal collection constant is a live possibility even though none
 * exists in src/ today.
 *
 * The dynamic-call gate has its own blind spot, one class up: `agent/store.ts` and
 * `db/user-data.ts` also match `.collection(‹expr›.collection)`, harvest zero local
 * literals, and are still fine — but not for the reason "no literal to harvest".
 * They're fine because their collection names are drawn from `MIGRATION_MANIFEST`
 * itself (`db/user-data.ts` filters it, `agent/store.ts` imports it and looks a
 * name up in it), so by construction they can never name anything outside the
 * manifest. That is a DIFFERENT reason than metrics.ts's "the literal is right
 * here, just behind a property read" — and a detector that accepts silence for
 * either reason without checking WHICH one applies would go blind the day someone
 * adds a `.collection(localVar)` to one of these files where `localVar` is NOT
 * manifest-derived: the gate would still match, still harvest zero, and stay
 * silent — a hole indistinguishable from a clean pass. So a file that trips the
 * dynamic gate MUST clear one of the two accounted-for reasons, or the detector
 * throws naming the file, rather than silently reporting nothing.
 */
export function collectionsReferencedIn(src: string, filePath: string): Set<string> {
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
    // A call whose argument reads a `.collection` property off some config
    // object (`ctx.db.collection(source.collection)`) carries no literal
    // itself, but the object literals in the same file that populate that
    // field do — see the doc comment above.
    const dynamicMemberCall = /\.(?:collection|collectionGroup)\(\s*[A-Za-z_][A-Za-z0-9_.]*\.collection\s*\)/;
    if (dynamicMemberCall.test(src)) {
        const configLiteral = /\bcollection\s*:\s*(["'`])([A-Za-z_][A-Za-z0-9_]*)\1/g;
        const before = found.size;
        for (const m of src.matchAll(configLiteral)) found.add(m[2]);
        const harvestedLocalLiteral = found.size > before;
        // Structural, not name-based: does this file import the manifest itself,
        // as opposed to merely mentioning the identifier in a comment or string?
        const importsManifest = /\bimport\s*(?:type\s*)?\{[^}]*\bMIGRATION_MANIFEST\b[^}]*\}\s*from/.test(src);
        if (!harvestedLocalLiteral && !importsManifest) {
            throw new Error(
                `${filePath}: calls .collection()/.collectionGroup() with a dynamic \`‹expr›.collection\` ` +
                    "argument, but this detector cannot account for where that name comes from — no " +
                    '`collection: "literal"` config in this file, and no MIGRATION_MANIFEST import to bound ' +
                    "it to already-migrated names. Either is required, or this collection reference is " +
                    "invisible to the completeness gate below.",
            );
        }
    }
    return found;
}

/** Walks every `.ts`/`.tsx` file under `srcDir` and unions the collection
 *  names `collectionsReferencedIn` finds in each. Defaults to this repo's
 *  `src/` directory. */
export function scanFirestoreCollections(srcDir: string = join(process.cwd(), "src")): Set<string> {
    const found = new Set<string>();
    (function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry)) {
                const src = readFileSync(full, "utf8");
                for (const name of collectionsReferencedIn(src, full)) found.add(name);
            }
        }
    })(srcDir);
    return found;
}

/**
 * The set a disclosure page must be checked against: every collection
 * `scanFirestoreCollections()` finds, UNIONED with every `collection` named
 * in `MIGRATION_MANIFEST`.
 *
 * The union is load-bearing, not belt-and-suspenders. `scanFirestoreCollections`
 * deliberately harvests zero collection names from a file that calls
 * `.collection(‹expr›.collection)` and imports `MIGRATION_MANIFEST` — see the
 * doc comment on `collectionsReferencedIn` above. `src/lib/agent/store.ts`
 * is exactly that file: it takes its collection name from a manifest lookup
 * (`agent_codes`, `agent_credentials`, `agent_record_budgets` among them), so
 * the scan alone is a strict undercount of it BY CONSTRUCTION, on purpose,
 * for every manifest-bounded call site — not a bug to fix in the scanner.
 * `CollectionSpec` has no cutover/status field, so every manifest entry is
 * still Firestore-live today and belongs in the union unconditionally. A
 * disclosure oracled on the scan alone will silently understate what is
 * stored; this is the only oracle that cannot.
 */
export function liveFirestoreCollections(srcDir?: string): Set<string> {
    const found = scanFirestoreCollections(srcDir);
    for (const spec of MIGRATION_MANIFEST) found.add(spec.collection);
    return found;
}

/**
 * Compares a disclosed set of collection names against the set actually
 * referenced in code, reported as two independent lists rather than a
 * boolean — an undisclosed live collection and a disclosed collection with
 * no live writer are different failures with different fixes (add to the
 * disclosure vs. remove from it), and collapsing them to "not equal" would
 * hide which one fired.
 */
export function diffDisclosedCollections(
    disclosed: Iterable<string>,
    actual: Iterable<string>,
): { undisclosed: string[]; stale: string[] } {
    const disclosedSet = new Set(disclosed);
    const actualSet = new Set(actual);
    return {
        undisclosed: [...actualSet].filter((c) => !disclosedSet.has(c)).sort(),
        stale: [...disclosedSet].filter((c) => !actualSet.has(c)).sort(),
    };
}

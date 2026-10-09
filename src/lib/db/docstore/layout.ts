/**
 * How each collection is laid out in the `intervu` Postgres schema once it
 * is sealed: which table it lives in (from MIGRATION_MANIFEST), and which few
 * fields stay readable beside the ciphertext so queries can find rows
 * without decrypting the whole table.
 *
 * THE RULE. A row is `path`, `sealed` (the whole document, AES-256-GCM) and
 * `doc`, which holds ONLY lookup fields:
 *  - readable: the owner id the row belongs to, the manifest's indexed
 *    fields (ids, dates, statuses), and a short list of non-personal flags;
 *  - hashed: personal values the app must match exactly (an email on the
 *    unsubscribe list, a sign-in username, a cache key), stored as a keyed
 *    hash that can be compared but not read;
 *  - and for collections whose document id IS an email, the id itself is
 *    hashed in `path`.
 * Everything else, the résumé, applications, notes, searches, exists only
 * inside `sealed`. Filters on any other field still work: the store reads
 * the candidate rows, opens them and filters in memory.
 */
import { MIGRATION_MANIFEST, type CollectionSpec } from "../firestore-migration-manifest";

interface LookupRule {
    /** Matched by keyed hash only (equality and `in`). */
    hashed?: readonly string[];
    /** Extra non-personal fields kept readable for counts and filters. */
    plain?: readonly string[];
    /** The document id is personal (an email): store it hashed in `path`. */
    hashIds?: boolean;
}

/** Collections that need more than the default rule. */
export const LOOKUP_RULES: Readonly<Record<string, LookupRule>> = {
    profiles: { hashed: ["username"] },
    interview_prep_cache: { hashed: ["cache_key"] },
    contact_messages: { hashed: ["email"] },
    connect_waitlist: { hashed: ["email"], hashIds: true },
    founding_waitlist: { hashed: ["email"], hashIds: true },
    welcome_emails: { hashed: ["email"] },
    email_suppressions: { hashIds: true },
    waitlist: { hashIds: true },
    // Admin counts of how searches went; none of these says who searched.
    search_events: { plain: ["widened", "filtersApplied", "unavailable", "backend"] },
};

export interface CollectionLayout {
    spec: CollectionSpec;
    table: string;
    readable: ReadonlySet<string>;
    hashed: ReadonlySet<string>;
    hashIds: boolean;
}

function layoutFor(spec: CollectionSpec): CollectionLayout {
    const rule = LOOKUP_RULES[spec.collection] ?? {};
    const hashed = new Set(rule.hashed ?? []);
    const readable = new Set<string>(rule.plain ?? []);
    if (spec.owner.by === "field") readable.add(spec.owner.field);
    for (const field of spec.indexed) readable.add(field.field);
    for (const field of hashed) readable.delete(field);
    return { spec, table: spec.table, readable, hashed, hashIds: Boolean(rule.hashIds) };
}

const LAYOUTS: ReadonlyMap<string, CollectionLayout> = new Map(
    MIGRATION_MANIFEST.map((spec) => [spec.collection, layoutFor(spec)]),
);

export function allLayouts(): CollectionLayout[] {
    return [...LAYOUTS.values()];
}

/** The layout for a collection id. Throws for a collection the manifest
 *  doesn't list: there is no table to put it in, and guessing one would
 *  scatter data where no export, deletion or copy will find it. */
export function layoutOf(collectionId: string): CollectionLayout {
    const layout = LAYOUTS.get(collectionId);
    if (!layout) {
        throw new Error(
            `Postgres store: collection '${collectionId}' is not in MIGRATION_MANIFEST (src/lib/db/firestore-migration-manifest.ts); add it there first`,
        );
    }
    return layout;
}

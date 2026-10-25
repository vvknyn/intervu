import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { diffDisclosedCollections, liveFirestoreCollections, scanFirestoreCollections } from "../support/firestore-collection-scan";

// privacy/page.tsx computes its `metadata` export via canonicalMetadata() at
// module scope, which throws if NEXT_PUBLIC_SITE_URL is unset — a real
// constraint of that module, unrelated to the FIRESTORE_COLLECTIONS_DISCLOSED
// constant this suite needs. A plain `import` is hoisted above any line that
// could set it first; `require` is not, so set a placeholder (only if the
// environment hasn't already provided a real one) before requiring the page.
if (!process.env.NEXT_PUBLIC_SITE_URL) {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
}
const {
    FIRESTORE_COLLECTIONS_DISCLOSED,
    FIRESTORE_STORAGE_CATEGORIES,
} = require("@/app/privacy/page") as typeof import("@/app/privacy/page");

const PRIVACY_PAGE_PATH = join(__dirname, "../../src/app/privacy/page.tsx");

function privacyPageSource(): string {
    return readFileSync(PRIVACY_PAGE_PATH, "utf8");
}

function privacyArticleSource(): string {
    const src = privacyPageSource();
    return src.split("<Prose")[1]?.split("</Prose>")[0] ?? "";
}

/**
 * /privacy's storage claims already drifted once: it said search activity
 * was NOT in Google Cloud Firestore while src/lib/jobs/search-log.ts:139 was
 * writing it there (fixed in 5d03378). Nothing forced a re-check when the
 * code changed. This suite ties FIRESTORE_COLLECTIONS_DISCLOSED (rendered on
 * the page itself, src/app/privacy/page.tsx) to the same detector the
 * firestore-migration-manifest suite uses to find every collection actually
 * referenced in src/, so the next drift — in either direction — fails a
 * test instead of waiting to be found by hand.
 */
describe("privacy page Firestore disclosure matches code", () => {
    // A comparison that only ever sees the passing case proves nothing —
    // this suite's own reason for existing is a drift that a same-shape
    // "equal" check would report as equal iff both directions happen to
    // pass. Drive it with a deliberately mismatched pair and require it to
    // name the offending collection on each side independently.
    it("CONTROL: diffDisclosedCollections reports both an undisclosed and a stale collection by name", () => {
        const { undisclosed, stale } = diffDisclosedCollections(
            ["disclosed_only", "shared"],
            ["shared", "actual_only"],
        );
        assert.deepEqual(undisclosed, ["actual_only"], "should name the live collection missing from disclosure");
        assert.deepEqual(stale, ["disclosed_only"], "should name the disclosed collection with no live writer");
    });

    it("CONTROL: reports no mismatch when the sets already agree", () => {
        const { undisclosed, stale } = diffDisclosedCollections(["a", "b"], ["b", "a"]);
        assert.deepEqual(undisclosed, []);
        assert.deepEqual(stale, []);
    });

    it("discloses every live Firestore collection (scan UNION manifest), and nothing else", () => {
        const { undisclosed, stale } = diffDisclosedCollections(
            FIRESTORE_COLLECTIONS_DISCLOSED,
            liveFirestoreCollections(),
        );
        assert.deepEqual(
            undisclosed,
            [],
            `/privacy does not disclose these live Firestore collections: ${undisclosed.join(", ")}. ` +
                "Add them to FIRESTORE_STORAGE_CATEGORIES in src/app/privacy/page.tsx.",
        );
        assert.deepEqual(
            stale,
            [],
            `/privacy discloses these collections but nothing in src/ writes them any more: ${stale.join(", ")}. ` +
                "Remove them from FIRESTORE_STORAGE_CATEGORIES — this is the direction that forces the page " +
                "to update when the Firestore exit lands.",
        );
    });

    // scanFirestoreCollections() alone is a strict undercount BY CONSTRUCTION
    // (see collectionsReferencedIn's doc comment): it harvests zero from
    // manifest-bounded call sites like src/lib/agent/store.ts. If a future
    // refactor ever dropped the manifest half of liveFirestoreCollections,
    // this suite would silently collapse back into the tautology it exists
    // to replace — the test above would still pass because both sides would
    // once again be derived from the same lone scan. Assert the union is a
    // strict superset of the scan, naming a collection the scan itself
    // cannot produce, so that regression fails loudly here instead.
    it("CONTROL: liveFirestoreCollections is a strict superset of scanFirestoreCollections", () => {
        const scanned = scanFirestoreCollections();
        const live = liveFirestoreCollections();
        for (const name of scanned) {
            assert.ok(live.has(name), `union dropped a scanned collection: ${name}`);
        }
        const manifestOnly = [...live].filter((c) => !scanned.has(c));
        assert.ok(
            manifestOnly.length > 0,
            "expected liveFirestoreCollections to contain at least one collection the bare scan cannot " +
                "produce (a manifest-bounded call site like src/lib/agent/store.ts) — if this is empty, the " +
                "manifest arm of the union was dropped and this suite has silently collapsed back into " +
                "asserting the scan against itself",
        );
    });

    it("carries no duplicate collection names", () => {
        assert.equal(
            new Set(FIRESTORE_COLLECTIONS_DISCLOSED).size,
            FIRESTORE_COLLECTIONS_DISCLOSED.length,
            FIRESTORE_COLLECTIONS_DISCLOSED.join(", "),
        );
    });

    it("FIRESTORE_STORAGE_CATEGORIES maps every disclosed collection id exactly once", () => {
        const labels = new Set<string>();
        const flattened: string[] = [];
        for (const category of FIRESTORE_STORAGE_CATEGORIES) {
            assert.ok(category.label.trim().length > 0, "each category needs a plain-language label");
            assert.ok(category.collections.length > 0, `category "${category.label}" must list collections`);
            assert.ok(!labels.has(category.label), `duplicate category label: ${category.label}`);
            labels.add(category.label);
            for (const collectionId of category.collections) {
                assert.match(
                    collectionId,
                    /^[A-Za-z_][A-Za-z0-9_]*$/,
                    `invalid Firestore collection id "${collectionId}" in category "${category.label}"`,
                );
                flattened.push(collectionId);
            }
        }
        assert.deepEqual(
            [...flattened].sort(),
            [...FIRESTORE_COLLECTIONS_DISCLOSED].sort(),
            "FIRESTORE_COLLECTIONS_DISCLOSED must stay derived from FIRESTORE_STORAGE_CATEGORIES",
        );
        assert.equal(
            new Set(flattened).size,
            flattened.length,
            "each collection id must appear in exactly one category",
        );
    });

    it("privacy article renders category.label for every category and never exposes collection ids", () => {
        const article = privacyArticleSource();
        assert.match(
            article,
            /FIRESTORE_STORAGE_CATEGORIES\.map\(\s*\(\s*category\s*\)\s*=>/,
            "article must map FIRESTORE_STORAGE_CATEGORIES",
        );
        assert.match(article, /\{category\.label\}/, "article must render category.label");
        assert.doesNotMatch(article, /category\.collections/, "article must not reference category.collections");
        assert.doesNotMatch(
            article,
            /FIRESTORE_COLLECTIONS_DISCLOSED/,
            "article must not reference FIRESTORE_COLLECTIONS_DISCLOSED",
        );
        assert.doesNotMatch(
            article,
            /Firestore collections these storage claims cover today are:/i,
            "article must not use the raw comma-separated collection dump",
        );
        assert.doesNotMatch(
            article,
            /FIRESTORE_COLLECTIONS_DISCLOSED\.join/,
            "article must not join FIRESTORE_COLLECTIONS_DISCLOSED into copy",
        );
        assert.doesNotMatch(
            article,
            /category\.collections\.join|collections\.join\(\s*["'],?\s*["']\s*\)/,
            "article must not join category collection ids into copy",
        );

        for (const collectionId of FIRESTORE_COLLECTIONS_DISCLOSED) {
            const escaped = collectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            assert.doesNotMatch(
                article,
                new RegExp(`["'\`]${escaped}["'\`]`),
                `quoted Firestore collection id "${collectionId}" must not appear in article JSX`,
            );
        }
    });
});

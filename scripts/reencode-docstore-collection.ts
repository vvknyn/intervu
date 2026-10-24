#!/usr/bin/env node
/**
 * Re-encode sealed docstore rows whose readable `doc` drifted from the current
 * lookup layout (see src/lib/db/docstore/reencode.ts). Dry run unless --apply.
 *
 *   node reencode-docstore-collection.cjs --collection=credit_grants        # counts only
 *   node reencode-docstore-collection.cjs --all                             # every manifest collection
 *   node reencode-docstore-collection.cjs --collection=credit_grants --apply
 *
 * Prints collection names and counts only, never document contents or uids.
 * Runs inside the Velai container with its own env (DATA_PG_URL,
 * DATA_ENCRYPTION_KEY); only pg is external:
 *   npx esbuild scripts/reencode-docstore-collection.ts --bundle --platform=node --format=cjs \
 *     --external:pg --outfile=reencode-docstore-collection.cjs
 */
import { allCollections, reencodeCollection } from "@/lib/db/docstore/reencode";
import { getPgDocDb } from "@/lib/db/docstore/pg-docstore";

export type ReencodeArgs = { collections: string[]; apply: boolean } | { error: string };

export function parseReencodeArgs(argv: readonly string[]): ReencodeArgs {
    const collection = argv.find((a) => a.startsWith("--collection="))?.slice("--collection=".length);
    if (Boolean(collection) === argv.includes("--all")) return { error: "give exactly one of --collection=<name> or --all" };
    return { collections: collection ? [collection] : allCollections(), apply: argv.includes("--apply") };
}

async function main(): Promise<void> {
    const args = parseReencodeArgs(process.argv.slice(2));
    if ("error" in args) {
        console.error(args.error);
        process.exit(2);
    }
    const db = getPgDocDb();
    console.log(`mode=${args.apply ? "APPLY" : "dry-run"}`);
    for (const collection of args.collections) {
        const r = await reencodeCollection(db, collection, args.apply);
        if (r.drifted || args.collections.length === 1) console.log(`${r.collection} scanned=${r.scanned} drifted=${r.drifted} rewritten=${r.rewritten}`);
    }
}

if (process.argv[1] && /reencode-docstore-collection\.(ts|cjs)$/.test(process.argv[1])) {
    main().then(() => process.exit(0), (err) => {
        console.error(err instanceof Error ? err.message : "failed");
        process.exit(1);
    });
}

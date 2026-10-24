#!/usr/bin/env node
/**
 * Revoke and erase Velai accounts that have no WorkOS user (orphans), through
 * the same machinery as Delete account (eraseAccount + realEraseDeps).
 * Dry run unless --apply.
 *
 *   node erase-orphan-accounts.cjs [--out=orphan-uids.txt]              # lists candidates, writes full uids to the file
 *   node erase-orphan-accounts.cjs --apply --uids=orphan-uids.txt       # erases exactly the uids in the file
 *
 * The delete list is never derived at apply time. --apply re-proves EVERY uid
 * on its own (WorkOS GET users/{uid} and GET users/external_id/{uid} must both
 * be 404) and aborts the whole run before any write on a 200 or any other
 * answer. Each uid's active agent credentials are revoked first. Prints counts
 * and uid labels (sha256 hex, 8 chars) only; the uid file is the only place full uids go.
 *
 * Runs inside the Velai container (see grant-access-days.ts for why): bundle,
 * copy in, run with the container's own env. Only pg is external:
 *   npx esbuild scripts/erase-orphan-accounts.ts --bundle --platform=node --format=cjs \
 *     --external:pg --outfile=erase-orphan-accounts.cjs
 *   docker cp erase-orphan-accounts.cjs <container>:/app/ && docker exec -w /app <container> node erase-orphan-accounts.cjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { WorkOS } from "@workos-inc/node";
import { isSkipped, eraseAccount } from "@/lib/account/erase-account";
import { realEraseDeps } from "@/lib/account/erase-deps";
import { assertAllOrphans, findOrphanUids, realOrphanSources, revokeActiveCredentials, uidLabel } from "@/lib/account/orphan-accounts";
import { getAgentStore } from "@/lib/agent/store";

export type EraseArgs = { apply: false; out: string } | { apply: true; uidsFile: string };

export function parseEraseArgs(argv: readonly string[]): EraseArgs | { error: string } {
    const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (!argv.includes("--apply")) return { apply: false, out: value("out") || "orphan-uids.txt" };
    const uidsFile = value("uids");
    return uidsFile ? { apply: true, uidsFile } : { error: "--apply requires --uids=<file> (written by the dry run)" };
}

/** One uid per line; blanks and duplicates dropped. */
export const parseUidFile = (text: string): string[] => [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];

async function main(): Promise<void> {
    const args = parseEraseArgs(process.argv.slice(2));
    if ("error" in args) {
        console.error(args.error);
        process.exit(2);
    }
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new Error("WORKOS_API_KEY is not set");
    const userManagement = new WorkOS(apiKey).userManagement;

    if (!args.apply) {
        const uids = await findOrphanUids(realOrphanSources(userManagement, getAgentStore()));
        writeFileSync(args.out, uids.map((u) => `${u}\n`).join(""));
        console.log(`mode=dry-run orphans=${uids.length} file=${args.out} labels=${uids.map(uidLabel).join(",")}`);
        return;
    }

    const uids = parseUidFile(readFileSync(args.uidsFile, "utf8"));
    if (!uids.length) throw new Error("uid file is empty");
    await assertAllOrphans(userManagement, uids);
    console.log(`mode=APPLY proven_orphans=${uids.length}`);

    const store = getAgentStore();
    const deps = realEraseDeps(async () => userManagement);
    let incomplete = 0;
    for (const uid of uids) {
        const revoked = await revokeActiveCredentials(store, uid);
        const results = await eraseAccount({ uid, email: null }, deps);
        const skipped = results.filter((r) => isSkipped(r.status)).map((r) => r.processor);
        if (skipped.length) incomplete++;
        console.log(`${uidLabel(uid)} revoked=${revoked} ${results.map((r) => `${r.processor}=${r.status}`).join(" ")}`);
    }
    console.log(`erased=${uids.length - incomplete} incomplete=${incomplete}`);
    if (incomplete) process.exit(1);
}

if (process.argv[1] && /erase-orphan-accounts\.(ts|cjs)$/.test(process.argv[1])) {
    main().then(() => process.exit(0), (err) => {
        console.error(err instanceof Error ? err.message : "failed");
        process.exit(1);
    });
}

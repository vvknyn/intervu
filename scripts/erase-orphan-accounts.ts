#!/usr/bin/env node
/**
 * Revoke and erase Velai accounts that have no WorkOS user (orphans), through
 * the same machinery as Delete account (eraseAccount + realEraseDeps).
 * Dry run unless --apply.
 *
 *   node erase-orphan-accounts.cjs [--out=orphan-uids.txt]              # lists candidates, writes full uids to the file
 *   node erase-orphan-accounts.cjs --apply --uids=orphan-uids.txt --expect=N   # erases exactly the uids in the file
 *
 * The delete list is never derived at apply time. --apply re-proves EVERY uid
 * on its own (WorkOS GET users/{uid} and GET users/external_id/{uid} must both
 * be 404) and aborts the whole run before any write on a 200 or any other
 * answer. --expect=N (the count the dry run printed) must equal the proven
 * orphans, and the orphans may not be ALL profiles: a wrong WorkOS environment
 * looks exactly like that. Each uid's active agent credentials are revoked first. Prints counts
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

export type EraseArgs = { apply: false; out: string } | { apply: true; uidsFile: string; expect: number };

export function parseEraseArgs(argv: readonly string[]): EraseArgs | { error: string } {
    const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (!argv.includes("--apply")) return { apply: false, out: value("out") || "orphan-uids.txt" };
    const uidsFile = value("uids");
    const expect = Number(value("expect"));
    if (!uidsFile || !Number.isInteger(expect) || expect < 1) return { error: "--apply requires --uids=<file> and --expect=<N> (both from the dry run)" };
    return { apply: true, uidsFile, expect };
}

/** Why an apply must not start, or null. Pure so the guards are testable without WorkOS. */
export function applyRefusal(uids: readonly string[], expect: number, profileCount: number): string | null {
    if (!uids.length) return "uid file is empty";
    if (uids.length !== expect) return `aborting, no writes made: ${uids.length} orphans in the file, --expect=${expect}`;
    if (uids.length >= profileCount) return "aborting, no writes made: every profile is an orphan, which looks like the wrong WorkOS environment";
    return null;
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
    const profileCount = (await realOrphanSources(userManagement, getAgentStore()).profileUids()).length;
    const refusal = applyRefusal(uids, args.expect, profileCount);
    if (refusal) throw new Error(refusal);
    await assertAllOrphans(userManagement, uids);
    console.log(`mode=APPLY proven_orphans=${uids.length}`);

    const store = getAgentStore();
    const deps = realEraseDeps(async () => userManagement);
    let incomplete = 0;
    for (const uid of uids) {
        try {
            const revoked = await revokeActiveCredentials(store, uid);
            const results = await eraseAccount({ uid, email: null }, deps);
            if (results.some((r) => isSkipped(r.status))) incomplete++;
            console.log(`${uidLabel(uid)} revoked=${revoked} ${results.map((r) => `${r.processor}=${r.status}`).join(" ")}`);
        } catch {
            incomplete++;
            console.log(`${uidLabel(uid)} incomplete=threw`);
        }
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

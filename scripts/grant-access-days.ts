#!/usr/bin/env node
/**
 * Grant free access days (launch grant). Dry run unless --apply.
 *
 *   node grant-access-days.cjs --days 30 --grant-id launch-2026-10 --all-accounts            # counts only
 *   node grant-access-days.cjs --days 30 --grant-id launch-2026-10 --all-accounts --apply
 *
 * "Every account" = every WorkOS user tagged for this product (listIntervuUsers,
 * keyed by toServerUser(user).uid) UNION every profile doc. A grant is stored once
 * per --grant-id, so re-running the same command never double-grants and repairs a
 * failed recompute. Prints counts only: never an email or a uid.
 *
 * Runs inside the Velai container (the runner image has no tsx and no scripts/):
 * bundle it, copy it in, run it with the container's own env.
 * Only pg resolves from /app there; WorkOS and firebase-admin do not, so
 * they are bundled (--external:pg is the sole external):
 *   npx esbuild scripts/grant-access-days.ts --bundle --platform=node --format=cjs \
 *     --external:pg --outfile=grant-access-days.cjs
 *   docker cp grant-access-days.cjs <container>:/app/ && docker exec -w /app <container> node grant-access-days.cjs --days 30 --grant-id launch-2026-10 --all-accounts
 */
import { WorkOS } from "@workos-inc/node";
import { toServerUser } from "@/lib/auth/workos-identity";
import { listIntervuUsers } from "@/lib/auth/workos-runtime";
import { GrantRecomputeError, grantDays } from "@/lib/billing/grants";
import { getAdminDb } from "@/lib/firebase/admin";

export interface GrantArgs {
    days: number;
    grantId: string;
    apply: boolean;
}

export function parseGrantArgs(argv: readonly string[]): GrantArgs | { error: string } {
    const daysAt = argv.indexOf("--days");
    const days = daysAt >= 0 ? Number(argv[daysAt + 1]) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 366) return { error: "--days N (1-366) is required" };
    const idAt = argv.indexOf("--grant-id");
    const grantId = idAt >= 0 ? (argv[idAt + 1] ?? "") : "";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(grantId)) return { error: "--grant-id ID (letters, digits, . _ -) is required" };
    if (!argv.includes("--all-accounts")) return { error: "--all-accounts is required" };
    return { days, grantId, apply: argv.includes("--apply") };
}

async function main(): Promise<void> {
    const args = parseGrantArgs(process.argv.slice(2));
    if ("error" in args) {
        console.error(args.error);
        process.exit(2);
    }
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new Error("WORKOS_API_KEY is not set");
    const workosUids = (await listIntervuUsers(new WorkOS(apiKey).userManagement)).map((u) => toServerUser(u).uid);
    const profileUids = (await getAdminDb().collection("profiles").select().get()).docs.map((d) => d.id);
    const targets = [...new Set([...workosUids, ...profileUids])];

    console.log(
        `mode=${args.apply ? "APPLY" : "dry-run"} days=${args.days} grant_id=${args.grantId} workos=${workosUids.length} profiles=${profileUids.length} accounts_to_grant=${targets.length}`,
    );
    if (!args.apply) return;

    let granted = 0;
    let alreadyGranted = 0;
    let grantFailed = 0;
    let recomputeFailed = 0;
    for (const uid of targets) {
        try {
            const { added } = await grantDays(uid, { id: args.grantId, days: args.days });
            if (added) granted++;
            else alreadyGranted++;
        } catch (error) {
            if (error instanceof GrantRecomputeError) recomputeFailed++;
            else grantFailed++;
        }
    }
    console.log(`granted=${granted} already_granted=${alreadyGranted} grant_write_failed=${grantFailed} recompute_failed=${recomputeFailed}`);
    if (grantFailed || recomputeFailed) process.exit(1);
}

if (process.argv[1] && /grant-access-days\.(ts|cjs)$/.test(process.argv[1])) {
    main().then(() => process.exit(0), (err) => {
        console.error(err instanceof Error ? err.message : "failed");
        process.exit(1);
    });
}

#!/usr/bin/env node
/**
 * Remove automated-test accounts from WorkOS User Management.
 *
 *   npx tsx scripts/clean-test-identities.ts                  # staging, report only
 *   npx tsx scripts/clean-test-identities.ts --apply          # staging, delete
 *   npx tsx scripts/clean-test-identities.ts --prod --apply   # production, delete
 *
 * Reports by default and deletes only with `--apply`, because the failure mode
 * is asymmetric: leaving a test account costs nothing, and removing a real one
 * removes a person's ability to sign in.
 *
 * What counts as a test account is decided by `src/lib/auth/test-identity.ts` —
 * properties of the address, never a list of known addresses, so a test run
 * that invents a fresh address tomorrow is still covered.
 *
 * This is recoverable, which is why it is safe to run: Firebase and Supabase
 * still hold every one of these rows, and the migrations are idempotent. The
 * migrations now skip test identities, so a re-run will not resurrect what this
 * removes.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classifyIdentity } from "../src/lib/auth/test-identity.ts";
import { createClient } from "./workos-sync.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");

/**
 * Addresses the operator names explicitly, e.g.
 * `--include a@b.com,c@d.com`.
 *
 * Some accounts are only knowable as tests by a human — a plus-addressed
 * mailbox, a personal login kept for exercising gated UI. Those judgements
 * belong to the operator at the command line, where they are logged with the
 * run, rather than baked into the predicate as a name list that would quietly
 * outlive the reason it was added.
 */
const includeArg = process.argv.indexOf("--include");
const INCLUDED = new Set(
    (includeArg === -1 ? "" : (process.argv[includeArg + 1] ?? ""))
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
);
const apiKey = PROD ? process.env.WORKOS_PROD_API_KEY : process.env.WORKOS_API_KEY;
if (!apiKey) {
    console.error(`missing ${PROD ? "WORKOS_PROD_API_KEY" : "WORKOS_API_KEY"}`);
    process.exit(1);
}

async function main() {
    const client = createClient(apiKey!);
    console.log(
        `target=${PROD ? "PRODUCTION" : "staging"} key_prefix=${apiKey!.slice(0, 8)} apply=${APPLY}`,
    );

    const users: any[] = [];
    let after: string | undefined;
    do {
        const res = await client.request(
            `/user_management/users?limit=100${after ? `&after=${after}` : ""}`,
        );
        users.push(...(res.body.data ?? []));
        after = res.body.list_metadata?.after;
    } while (after);
    console.log(`total_users=${users.length}`);

    const tally = { deleted: 0, would_delete: 0, kept_active: 0, failed: 0 };

    for (const user of users) {
        const named = INCLUDED.has((user.email ?? "").trim().toLowerCase());
        const verdict = named
            ? ({ isTest: true, reason: "named_by_operator" } as const)
            : classifyIdentity(user.email);
        if (!verdict.isTest) continue;

        // A second, independent belt: whatever the address looks like, an
        // account somebody has actually signed in with is not litter. If these
        // two signals ever disagree, the account survives and says so.
        if (user.last_sign_in_at) {
            tally.kept_active++;
            console.log(
                `KEPT ${user.email} — matches ${verdict.reason} but has signed in (${user.last_sign_in_at})`,
            );
            continue;
        }

        if (!APPLY) {
            tally.would_delete++;
            console.log(`would_delete ${user.email}  (${verdict.reason})`);
            continue;
        }

        const res = await client.request(`/user_management/users/${user.id}`, {
            method: "DELETE",
        });
        if (res.ok || res.status === 404) {
            tally.deleted++;
            console.log(`deleted ${user.email}  (${verdict.reason})`);
        } else {
            tally.failed++;
            console.log(`FAILED ${user.email} http=${res.status}`);
        }
    }

    console.log(`\nresult ${JSON.stringify(tally)}`);
    process.exit(tally.failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

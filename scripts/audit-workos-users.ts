#!/usr/bin/env node
/**
 * Read the WorkOS tenant back and report what is actually there.
 *
 *   npx tsx scripts/audit-workos-users.ts          # staging
 *   npx tsx scripts/audit-workos-users.ts --prod   # production
 *
 * A migration's own summary only proves what it BELIEVES it did. This reads
 * the destination independently and answers the questions that matter after a
 * move: is anyone missing an `external_id` (their old data would be orphaned),
 * is anyone untagged (they came from neither migration — a native signup), and
 * is anyone in no organization.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "./workos-sync.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const PROD = process.argv.includes("--prod");
const apiKey = PROD ? process.env.WORKOS_PROD_API_KEY : process.env.WORKOS_API_KEY;
if (!apiKey) {
    console.error(`missing ${PROD ? "WORKOS_PROD_API_KEY" : "WORKOS_API_KEY"}`);
    process.exit(1);
}

async function main() {
    const client = createClient(apiKey!);
    console.log(`target=${PROD ? "PRODUCTION" : "staging"} key_prefix=${apiKey!.slice(0, 8)}`);

    const orgs = (await client.request("/organizations?limit=100")).body.data ?? [];
    console.log(`organizations=${orgs.map((o: any) => `${o.name}:${o.id}`).join(" ")}`);

    // Page rather than assuming one request holds everyone — the count is the
    // thing being verified, so it must not be capped by the page size.
    const users: any[] = [];
    let after: string | undefined;
    do {
        const res = await client.request(
            `/user_management/users?limit=100${after ? `&after=${after}` : ""}`,
        );
        users.push(...(res.body.data ?? []));
        after = res.body.list_metadata?.after;
    } while (after);

    const memberships = new Map<string, string[]>();
    for (const org of orgs) {
        let cursor: string | undefined;
        do {
            const res = await client.request(
                `/user_management/organization_memberships?organization_id=${org.id}&limit=100${cursor ? `&after=${cursor}` : ""}`,
            );
            for (const m of res.body.data ?? []) {
                memberships.set(m.user_id, [...(memberships.get(m.user_id) ?? []), org.name]);
            }
            cursor = res.body.list_metadata?.after;
        } while (cursor);
    }

    const byApps: Record<string, number> = {};
    const noExternalId: string[] = [];
    const untagged: string[] = [];
    const noOrg: string[] = [];
    const emails = new Set<string>();
    const duplicates: string[] = [];

    for (const u of users) {
        const apps = u.metadata?.apps ?? "(none)";
        byApps[apps] = (byApps[apps] ?? 0) + 1;
        if (!u.external_id) noExternalId.push(u.email);
        if (!u.metadata?.apps) untagged.push(u.email);
        if (!memberships.get(u.id)?.length) noOrg.push(u.email);
        if (emails.has(u.email)) duplicates.push(u.email);
        emails.add(u.email);
    }

    console.log(`\ntotal_users=${users.length}`);
    console.log(`by_apps ${JSON.stringify(byApps)}`);
    console.log(`duplicates=${duplicates.length}${duplicates.length ? " " + duplicates.join(" ") : ""}`);
    console.log(`missing_external_id=${noExternalId.length}${noExternalId.length ? " " + noExternalId.join(" ") : ""}`);
    console.log(`no_organization=${noOrg.length}${noOrg.length ? " " + noOrg.join(" ") : ""}`);
    console.log(`untagged=${untagged.length}${untagged.length ? " " + untagged.join(" ") : ""}`);

    const both = users.filter((u) => (u.metadata?.apps ?? "").includes(",")).map((u) => u.email);
    console.log(`in_both_products=${both.length}${both.length ? " " + both.join(" ") : ""}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

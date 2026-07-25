#!/usr/bin/env node
/**
 * Add "id" to the jobs index's filterableAttributes — the one setting the live
 * index is still missing.
 *
 * WHY THIS MATTERS
 *   Meilisearch's primary key is not automatically filterable, so `id = "..."`
 *   filters 400 today. Every by-id lookup in the app depends on it:
 *     - the pursuit screen's "open the live posting" sheet (/yours/[id])
 *     - the dead-link existence check (classifyExistenceCheck), which is why
 *       several job=<id> e2e tests fail
 *   Both degrade honestly to "we can't confirm" rather than lying, and both
 *   start working the moment this lands. No app deploy is needed.
 *
 * WHY IT NEEDS A WINDOW
 *   Changing filterableAttributes re-indexes the whole corpus (~1.87M docs).
 *   The box is now LIVE (cutover completed 2026-07-25), so there is no longer
 *   a free window — this re-index lands on the index production is reading.
 *   Re-indexing under load is what produced the 20s-browse incident.
 *
 *   The sync worker also writes continuously, so `isIndexing` is rarely false
 *   on its own. For a genuinely quiet window, pause sync first:
 *     sudo systemctl stop meili-sync.timer     # and any embedding job
 *     …run this…
 *     sudo systemctl start meili-sync.timer
 *
 * SAFE BY DEFAULT
 *   Dry run unless you pass --apply. It refuses to start while the index is
 *   already indexing, it is idempotent (a no-op once "id" is present), and it
 *   verifies with a real id filter afterwards instead of trusting the task
 *   status.
 *
 *   node scripts/apply-id-filterable.mjs                 # plan only
 *   node scripts/apply-id-filterable.mjs --apply         # do it, wait, verify
 *   node scripts/apply-id-filterable.mjs --apply --force # ignore isIndexing
 *   node scripts/apply-id-filterable.mjs --rollback --apply
 *
 * Target: --host=… --key=… beat every environment variable, which beat
 * .env.local. --expect-host=<substring> refuses to run unless the resolved
 * host matches — cheap insurance against re-indexing the wrong box when two
 * are alive during a migration.
 *
 * Env fallbacks: MEILISEARCH_HOST / MEILI_URL, and MEILISEARCH_ADMIN_KEY /
 * MEILI_ADMIN_KEY / MEILI_MASTER_KEY. The admin key is usually NOT in
 * .env.local — export it, or pull it from the box:
 *
 *   CREDS=$(ssh subspace@194.163.147.154 'set -a; . /opt/jobs-sync/.env; set +a;
 *            printf "%s|%s" "$MEILI_URL" "$MEILI_MASTER_KEY"')
 *   node scripts/apply-id-filterable.mjs --host="${CREDS%%|*}" --key="${CREDS##*|}" \
 *        --expect-host=meili-box
 *
 * The filterable list is READ from the index and written back with "id"
 * appended — never a hardcoded copy, which would silently revert whatever the
 * sync worker had provisioned.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

/**
 * Anything the operator actually exported wins over the repo's .env.local.
 *
 * This matters more here than in a normal script: .env.local carries
 * MEILISEARCH_HOST for the app, which is not necessarily the box you mean to
 * re-index. Read literally, `MEILISEARCH_HOST ?? MEILI_URL` let a stale file
 * value silently outrank an explicitly exported MEILI_URL — pointing a
 * whole-corpus re-index at the wrong Meilisearch. Observed doing exactly that.
 */
const exported = { ...process.env };
const fromFile = {};
try {
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) fromFile[m[1]] = m[2];
  }
} catch {}
const pick = (...names) => {
  for (const n of names) if (exported[n]) return exported[n];
  for (const n of names) if (fromFile[n]) return fromFile[n];
  return "";
};

const HOST = (arg("host") ?? pick("MEILISEARCH_HOST", "MEILI_URL")).replace(/\/+$/, "");
const KEY = arg("key") ?? pick("MEILISEARCH_ADMIN_KEY", "MEILI_ADMIN_KEY", "MEILI_MASTER_KEY");
if (!HOST || !KEY) {
  console.error(
    "Missing host or admin key.\n" +
      "  --host=https://… --key=… , or export MEILISEARCH_HOST/MEILI_URL +\n" +
      "  MEILISEARCH_ADMIN_KEY/MEILI_ADMIN_KEY/MEILI_MASTER_KEY.",
  );
  process.exit(1);
}
if (arg("expect-host") && !HOST.includes(arg("expect-host"))) {
  console.error(`REFUSING: resolved host ${HOST} does not match --expect-host=${arg("expect-host")}.`);
  process.exit(5);
}

const INDEX = "jobs";
const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const rollback = process.argv.includes("--rollback");

const call = async (path, init = {}) => {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${String(text).slice(0, 200)}`);
  return body;
};

const main = async () => {
  console.log(`host    ${HOST}`);
  console.log(`index   ${INDEX}`);
  console.log(`mode    ${rollback ? "ROLLBACK (remove id)" : "add id"}${apply ? "" : "  [dry run — pass --apply to execute]"}`);

  const stats = await call(`/indexes/${INDEX}/stats`);
  console.log(`docs    ${stats.numberOfDocuments?.toLocaleString?.() ?? stats.numberOfDocuments}`);
  console.log(`indexing ${stats.isIndexing}`);

  const current = await call(`/indexes/${INDEX}/settings/filterable-attributes`);
  const has = current.includes("id");
  console.log(`filterable currently ${current.length} attrs; "id" present: ${has}`);

  const next = rollback ? current.filter((a) => a !== "id") : has ? current : [...current, "id"];
  if (next.length === current.length && (rollback ? !has : has)) {
    console.log(rollback ? '\n"id" is already absent — nothing to do.' : '\n"id" is already filterable — nothing to do.');
    if (!rollback) await verify();
    return;
  }

  // The documented hazard: this enqueues a full re-index. Stacking it on top of
  // one already running is how a maintenance window turns into an incident.
  // Only an --apply is blocked; a dry run reads nothing but stats and settings,
  // so it stays useful for checking whether the window has opened yet.
  const busy = stats.isIndexing && !force;

  if (!apply) {
    console.log(`\nWould PUT filterable-attributes (${current.length} → ${next.length}):`);
    console.log(`  ${rollback ? "removing" : "adding"}: id`);
    console.log(`\nThis re-indexes ~${(stats.numberOfDocuments ?? 0).toLocaleString()} documents on a LIVE index.`);
    console.log(
      busy
        ? "\nNOT READY: the index is busy. The sync worker writes continuously, so this rarely\n" +
          "clears by itself — pause sync (systemctl stop meili-sync.timer) plus any embedding\n" +
          "job for a real window, then re-run. --force overrides, at the cost of stacking a\n" +
          "full re-index on whatever is already running."
        : "\nREADY: the index is idle. Re-run with --apply.",
    );
    return;
  }

  if (busy) {
    console.error(
      "\nREFUSING: the index is currently indexing. Wait for it to settle (indexing false)," +
        "\nthen re-run. Use --force only if you know the in-flight task is unrelated and idle.",
    );
    process.exit(2);
  }

  const started = Date.now();
  const task = await call(`/indexes/${INDEX}/settings/filterable-attributes`, {
    method: "PUT",
    body: JSON.stringify(next),
  });
  console.log(`\nenqueued task ${task.taskUid} — re-indexing ~${(stats.numberOfDocuments ?? 0).toLocaleString()} docs`);

  // Poll rather than assume. A settings task can fail long after it enqueues.
  for (;;) {
    await new Promise((r) => setTimeout(r, 15_000));
    const t = await call(`/tasks/${task.taskUid}`);
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    if (t.status === "succeeded") {
      console.log(`task succeeded after ${mins}m`);
      break;
    }
    if (t.status === "failed" || t.status === "canceled") {
      console.error(`task ${t.status} after ${mins}m: ${JSON.stringify(t.error ?? {}).slice(0, 300)}`);
      process.exit(3);
    }
    console.log(`  ${t.status}… ${mins}m`);
  }

  if (!rollback) await verify();
};

/** Prove it with a real filter, not the task status. */
async function verify() {
  const sample = await call(`/indexes/${INDEX}/search`, {
    method: "POST",
    body: JSON.stringify({ q: "", hitsPerPage: 1, page: 1 }),
  });
  const id = sample.hits?.[0]?.id;
  if (!id) {
    console.log("\nVERIFY skipped: index returned no documents to sample.");
    return;
  }
  try {
    const hit = await call(`/indexes/${INDEX}/search`, {
      method: "POST",
      body: JSON.stringify({ q: "", filter: [`id = ${JSON.stringify(id)}`], hitsPerPage: 1, page: 1 }),
    });
    const ok = hit.hits?.length === 1 && hit.hits[0].id === id;
    console.log(ok ? `\nVERIFY PASS — id filter resolves (${id}).` : `\nVERIFY FAIL — filter accepted but returned ${hit.hits?.length ?? 0} hits.`);
    if (!ok) process.exit(4);
  } catch (e) {
    console.error(`\nVERIFY FAIL — id filter still rejected: ${String(e).slice(0, 200)}`);
    process.exit(4);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

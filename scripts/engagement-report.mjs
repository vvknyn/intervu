#!/usr/bin/env node
/**
 * intervu engagement scoreboard — first-party server logs only. intervu runs
 * zero client analytics (privacy page: "no analytics scripts"), so this is
 * the only behavioral data there is. Read-only by construction.
 *
 * COLLECTIONS (traced from write call sites, not guessed)
 *   search_events — src/lib/jobs/search-log.ts COLLECTION_SEARCHES, written
 *     by recordSearch() (actions/jobs.ts:121, buildSearchLogEntry). No uid,
 *     no session key — see the retention note this script prints.
 *   search_opens — COLLECTION_OPENS, written by recordJobOpen()
 *     (actions/jobs.ts:298, buildJobOpenEntry). Joins to search_events on
 *     searchId.
 *   applications — the pursuits collection (lib/pursuits/types.ts header:
 *     "Backed by the existing Firestore `applications` collection"), written
 *     by actions/application.ts + lib/pursuits/upsert-core.ts. Has user_id,
 *     created_at, and optional applied_at (stamped client-side the moment
 *     status becomes "applied" — src/app/yours/page.tsx, [id]/page.tsx).
 *     Per-user, so unlike search/open logs these ARE attributable.
 *
 * CREDENTIALS — same contract as src/lib/firebase/admin.ts (reimplemented,
 *   not imported: that module is TypeScript and this is a build-step-free
 *   .mjs script): FIREBASE_SERVICE_ACCOUNT_KEY, or FIREBASE_CLIENT_EMAIL +
 *   FIREBASE_PRIVATE_KEY + NEXT_PUBLIC_FIREBASE_PROJECT_ID. Reads .env.local
 *   if present (repo convention, see apply-id-filterable.mjs); exported vars
 *   win. No local creds? They're in the prod env on the box:
 *     ssh subspace@194.163.147.154
 *     cd /opt/intervu && node scripts/engagement-report.mjs --days 7
 *
 * USAGE
 *   node scripts/engagement-report.mjs [--days N]     # default 7
 *   node scripts/engagement-report.mjs --help
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const here = dirname(fileURLToPath(import.meta.url));

const HELP = `intervu engagement report — plain-text scoreboard over search_events, search_opens, applications (read-only).

Usage: node scripts/engagement-report.mjs [--days N]   (default 7)
       node scripts/engagement-report.mjs --help

Credentials: FIREBASE_SERVICE_ACCOUNT_KEY, or FIREBASE_CLIENT_EMAIL +
FIREBASE_PRIVATE_KEY + NEXT_PUBLIC_FIREBASE_PROJECT_ID (same contract as
src/lib/firebase/admin.ts). Reads .env.local if present; exported vars win.
No local creds? They're in the prod env on the box:
  ssh subspace@194.163.147.154 && cd /opt/intervu && node scripts/engagement-report.mjs --days 7`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v !== undefined ? v : fallback;
};

const days = Number(argValue("days", "7"));
if (!Number.isFinite(days) || days <= 0) {
  console.error(`Invalid --days value: ${argValue("days")}`);
  process.exit(1);
}

// Same "exported wins over .env.local" resolution as apply-id-filterable.mjs.
const exported = { ...process.env };
const fromFile = {};
try {
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) fromFile[m[1]] = m[2];
  }
} catch {}
const pick = (name) => exported[name] || fromFile[name] || "";

function getDb() {
  const svc = pick("FIREBASE_SERVICE_ACCOUNT_KEY");
  const credential = svc
    ? cert(JSON.parse(svc))
    : cert({
        projectId: pick("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
        clientEmail: pick("FIREBASE_CLIENT_EMAIL"),
        privateKey: pick("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      });
  return getFirestore(initializeApp({ credential }));
}

const READ_LIMIT = 50_000;

/** Pure: chronological range query, capped so an unbounded collection can
 *  never blow up a report run. Returns { rows, truncated }. */
async function queryRange(db, collection, field, startIso, endIso) {
  const snap = await db
    .collection(collection)
    .where(field, ">=", startIso)
    .where(field, "<", endIso)
    .limit(READ_LIMIT)
    .get();
  const rows = snap.docs.map((d) => d.data());
  return { rows, truncated: rows.length === READ_LIMIT };
}

// ---- pure helpers (no I/O — safe to read/test in isolation) ----
export const dayKey = (iso) => iso.slice(0, 10);
export const distinctDays = (rows, field) => new Set(rows.map((r) => dayKey(r[field]))).size;
export const distinctUsers = (rowArrays, field) =>
  new Set(rowArrays.flat().map((r) => r[field])).size;
export const rate = (n, d) => (d > 0 ? n / d : null);
export const fmtPct = (r) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
export const fmtPerDay = (n) => `${(n / days).toFixed(1)}/day`;
export function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sampleNote(name, truncated) {
  return truncated ? `  ⚠ ${name} hit the ${READ_LIMIT.toLocaleString()}-doc cap — rates below are a sample, not the full window.` : null;
}

async function main() {
  const db = getDb();
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [searches, opens, created, applied] = await Promise.all([
    queryRange(db, "search_events", "createdAt", startIso, endIso),
    queryRange(db, "search_opens", "createdAt", startIso, endIso),
    queryRange(db, "applications", "created_at", startIso, endIso),
    queryRange(db, "applications", "applied_at", startIso, endIso),
  ]);

  const s = searches.rows;
  const searchIds = new Set(s.map((r) => r.searchId));
  const joinedOpens = opens.rows.filter((o) => searchIds.has(o.searchId));

  console.log(`intervu engagement report — last ${days}d (${startIso} → ${endIso})\n`);

  console.log("SEARCH (search_events)");
  console.log(`  total searches            ${s.length}  (${fmtPerDay(s.length)}, ${distinctDays(s, "createdAt")} distinct calendar days active)`);
  console.log(`  zero-result rate          ${fmtPct(rate(s.filter((r) => r.resultCount === 0).length, s.length))}`);
  console.log(`  widened rate              ${fmtPct(rate(s.filter((r) => r.widened === true).length, s.length))}`);
  console.log(`  unavailable/backend-error ${fmtPct(rate(s.filter((r) => r.unavailable === true).length, s.length))}`);

  console.log("\nOPEN-THROUGH (search_opens, joined to search_events by searchId)");
  console.log(`  open-through rate         ${fmtPct(rate(joinedOpens.length, s.length))}  (${joinedOpens.length} opens / ${s.length} searches)`);
  console.log(`  median rank opened        ${median(joinedOpens.map((o) => o.rank)) ?? "n/a"}`);

  console.log("\nPURSUITS (applications — per-user, attributable)");
  console.log(`  created                   ${created.rows.length}  (${fmtPerDay(created.rows.length)})`);
  console.log(`  marked applied            ${applied.rows.length}  (${fmtPerDay(applied.rows.length)})  [applied_at]`);
  const activeUsers = distinctUsers([created.rows, applied.rows], "user_id");
  console.log(`  distinct active users     ${activeUsers}  (${fmtPerDay(activeUsers)} avg)`);

  console.log("\nRETENTION");
  console.log(
    "  Not measurable from search/open logs: buildSearchLogEntry (src/lib/jobs/search-log.ts)\n" +
      "  stores no uid or session key by design (\"Deliberately anonymous\" — searchId is random\n" +
      "  per search, so events can't be chained into one person's history). Only the PURSUITS\n" +
      "  numbers above are per-user; searches/opens above are not.",
  );

  const notes = [
    sampleNote("search_events", searches.truncated),
    sampleNote("search_opens", opens.truncated),
    sampleNote("applications (created_at)", created.truncated),
    sampleNote("applications (applied_at)", applied.truncated),
  ].filter(Boolean);
  if (notes.length) console.log(`\nSAMPLING\n${notes.join("\n")}`);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});

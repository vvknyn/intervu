#!/usr/bin/env node
/**
 * End-to-end proof that a real telemetry event survives
 * browser -> HTTP -> guards -> Postgres.
 *
 *   TARGET_URL=http://localhost:3000 BATCH_PG_URL=... \
 *     npx tsx scripts/verify-telemetry-e2e.ts
 *
 * WHY THIS SCRIPT EXISTS: `POST /api/telemetry` (src/app/api/telemetry/route.ts)
 * is deliberately written to NEVER throw and to ALWAYS return 204, even when
 * it silently drops the event (route.ts guards 9/10 — "telemetry failing
 * must never break a page"). At least 7 independent ways this happens in
 * prod, and a 204 alone never distinguishes any of them from a healthy
 * write: schema drift (a pre-spec table missing a column this route's insert
 * depends on), a caught insert exception, `TELEMETRY_PG_URL` unset, bot-UA
 * classification, or any of the 5 `TelemetryRejectionReason`s (shape, name,
 * size, duplicate, rate limit). `buildMissingRowDiagnosis` below only ever
 * asserts the one cause (schema drift) it can actually establish from
 * `information_schema` — everything else it reports as an honest,
 * undistinguished list rather than a guess.
 *
 * This is a script an operator runs deliberately after a deploy, never a
 * cron and never wired into preflight (scripts/ is excluded from
 * tsconfig.json's `include` on purpose — see that file). It posts one
 * synthetic event over real HTTP, reads it back from Postgres via
 * `BATCH_PG_URL` (the `pipeline` role — `telemetry_pg`, what
 * `TELEMETRY_PG_URL` connects as, is INSERT-only and cannot SELECT, see
 * deploy/db-box/telemetry-schema.sql §4), asserts every column that should
 * have landed did, with the right value, and always deletes its own
 * synthetic row afterward — a synthetic row left behind in a production
 * ledger is exactly the "looks fine, isn't" failure this script exists to
 * catch, so cleanup succeeding is part of the pass/fail verdict, not a
 * best-effort afterthought.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TELEMETRY_COLUMNS } from "../src/app/api/telemetry/route";
import { TELEMETRY_REJECTION_REASONS } from "../src/lib/telemetry/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** How far back "recent activity" looks when deciding whether the write
 *  path is working at all vs. only this one event was dropped — see
 *  `buildMissingRowDiagnosis`. */
const RECENT_ACTIVITY_WINDOW = "5 minutes";

// Non-bot per lib/telemetry/ingest.ts's `isBotUserAgent`: Node's fetch
// (undici) sends no default User-Agent header at all, which trims to "" and
// isBotUserAgent treats an empty UA as a bot outright
// (`if (!ua) return true` — ingest.ts:76). This string contains none of
// "bot"/"spider"/"crawler" (GENERIC_BOT_PATTERN, ingest.ts:72) and matches
// none of the named crawlers NAMED_BOT_PATTERN builds from
// (SEARCH_ENGINE_BOTS + AI_ANSWER_ENGINE_BOTS, lib/shield/robots-policy.ts).
const USER_AGENT = "intervu-telemetry-e2e-verify/1.0";

// Safety margin for a slow box, not evidence the write is inherently async
// — route.ts awaits the insert before returning 204 (guard 8, then guard 9).
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface CheckResult {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
}

function runCheck(name: string, actual: unknown, expected: unknown, pass: boolean): CheckResult {
  if (pass) console.log(`PASS ${name}`);
  else console.error(`FAIL ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  return { name, pass, actual, expected };
}

/**
 * Pure decision: everything this script can honestly conclude about a
 * missing row, from two cheaply-checkable facts. The route has 7+ distinct
 * ways to admit-then-drop an event silently — the 5 `TELEMETRY_REJECTION_REASONS`
 * (a session/IP rate limit among them), bot-UA classification (guard 6), a
 * caught insert exception (route.ts's guard-8 catch), OR a pipeline-wide
 * failure (TELEMETRY_PG_URL unset, connectivity, an uncaught exception) — and
 * this function can only ever establish ONE of those with certainty:
 * `missingColumns` non-empty IS schema drift, proven by the query that built
 * it. Every other cause stays an enumerated possibility, never an assertion,
 * because naming one this script hasn't ruled out is how an operator gets
 * sent to fix the wrong thing — e.g. a prior run against the same IP tripping
 * `rate-limit.ts`'s budget leaves the schema completely intact, and the old
 * two-branch version of this function would have confidently (and wrongly)
 * blamed a missing `TELEMETRY_PG_URL`.
 *
 * `recentRowCount` (any OTHER row landed inside `RECENT_ACTIVITY_WINDOW`) is
 * the other cheap signal: it distinguishes "the write path works at all" from
 * "nothing is landing," which narrows the enumeration without pretending to
 * pick a single cause within it.
 */
export function buildMissingRowDiagnosis(missingColumns: readonly string[], recentRowCount: number): string {
  if (missingColumns.length > 0) {
    return (
      `DIAGNOSIS: schema drift established — intervu.telemetry_events is missing ` +
      `column(s) this route's insert depends on: [${missingColumns.join(", ")}]. ` +
      `Compare the live table against deploy/db-box/telemetry-schema.sql and re-apply it.`
    );
  }

  const perEventCauses = [
    ...TELEMETRY_REJECTION_REASONS.map((reason) => `rejected as "${reason}" (ingest.ts / rate-limit.ts)`),
    `classified as a bot user-agent and dropped before rate limiting (ingest.ts's isBotUserAgent)`,
    `the insert itself threw and was caught (route.ts logs it under "[telemetry] insert failed" but still returns 204)`,
  ];
  const pipelineWideCauses = [
    "TELEMETRY_PG_URL is unset in the container env (getTelemetryPg() returns null, the insert is skipped outright)",
    "the pool can't reach Postgres at all (network/credentials)",
    "an uncaught exception earlier in the request (route.ts's outer catch still returns 204)",
  ];

  const scope =
    recentRowCount > 0
      ? `${recentRowCount} OTHER row(s) landed in the last ${RECENT_ACTIVITY_WINDOW}, so the write path is at ` +
        `least partially working — this looks like an isolated drop of this one event. Undistinguished ` +
        `possibilities (this script cannot tell which):`
      : `no rows at all landed in the last ${RECENT_ACTIVITY_WINDOW}, so this may be a pipeline-wide failure. ` +
        `Undistinguished possibilities (this script cannot tell which):`;
  const causes = recentRowCount > 0 ? perEventCauses : [...pipelineWideCauses, ...perEventCauses];

  return (
    `DIAGNOSIS: schema looks correct (every column this route inserts is present), so no single cause is ` +
    `established. ${scope}\n` +
    causes.map((c) => `  - ${c}`).join("\n") +
    `\nThis script only reads information_schema and a recent-row count — check the app's own ` +
    `"[telemetry]"-prefixed logs near this run's timestamp to narrow it down further.`
  );
}

/** Thin I/O: gathers the two facts `buildMissingRowDiagnosis` needs. Never
 *  touches the missing row itself (never even queries by event_id), so it
 *  can't tell you anything false about the row that's actually missing. */
async function diagnoseMissingRow(db: pg.Client): Promise<string> {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
     where table_schema = 'intervu' and table_name = 'telemetry_events'`,
  );
  const actualColumns = new Set(rows.map((r) => r.column_name as string));
  const missingColumns = TELEMETRY_COLUMNS.filter((c) => !actualColumns.has(c));

  const { rows: recentRows } = await db.query(
    `select count(*)::int as n from intervu.telemetry_events where received_at > now() - interval '${RECENT_ACTIVITY_WINDOW}'`,
  );
  const recentRowCount = (recentRows[0]?.n as number | undefined) ?? 0;

  return buildMissingRowDiagnosis(missingColumns, recentRowCount);
}

async function main(): Promise<void> {
  // Loaded so an operator who already has BATCH_PG_URL configured locally for
  // other box scripts doesn't have to re-export it by hand just for this one.
  // TARGET_URL will essentially never be present in .env.local today — nothing
  // else in this repo needs "which host am I hitting" outside a script like
  // this — so the "no env set" case below still fails loudly regardless of
  // what .env.local happens to contain. Deferred to main() (rather than
  // module scope) so importing this file for its pure exports — as the test
  // for `buildMissingRowDiagnosis` does — never touches the filesystem or
  // exits the process.
  config({ path: `${ROOT}/.env.local`, quiet: true });

  const targetUrl = process.env.TARGET_URL;
  if (!targetUrl) {
    console.error("no target: set TARGET_URL (e.g. http://localhost:3000)");
    process.exit(1);
  }

  const connectionString = process.env.BATCH_PG_URL;
  if (!connectionString) {
    console.error(
      "no pg url: set BATCH_PG_URL (the `pipeline` role — telemetry_pg is " +
        "INSERT-only and cannot read this back, see telemetry-schema.sql §4)",
    );
    process.exit(1);
  }

  const eventId = randomUUID();
  const sessionId = randomUUID(); // fresh per run so the per-session rate
  // budget (rate-limit.ts) can never be pre-exhausted by a prior run.
  const queryId = randomUUID();
  const jobId = `selfcheck-job-${randomUUID().slice(0, 8)}`;
  const companyDomain = "verify-telemetry-e2e.invalid"; // .invalid — RFC 2606, reserved for exactly this non-collision purpose
  const position = 7;
  const nonce = randomUUID();
  const props = { probe: "verify-telemetry-e2e", nonce };

  const event = {
    event_id: eventId,
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    event_name: "telemetry_selfcheck",
    source: "e2e-verify",
    query_id: queryId,
    job_id: jobId,
    company_domain: companyDomain,
    position,
    props,
  };

  console.log(`[verify-telemetry-e2e] POST ${targetUrl}/api/telemetry event_id=${eventId}`);

  const response = await fetch(`${targetUrl}/api/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ events: [event] }),
  });

  const statusCheck = runCheck("http_status_204", response.status, 204, response.status === 204);
  if (!statusCheck.pass) {
    // Nothing was inserted (a non-204 here means the route rejected the
    // payload itself, e.g. 413/400 for malformed shape — not a silent-drop
    // case), so there is nothing to poll for and nothing to clean up.
    throw new Error(
      `endpoint returned ${response.status}, expected 204 — payload was rejected before any insert was attempted`,
    );
  }

  const db = new pg.Client({ connectionString });
  await db.connect();

  const checks: CheckResult[] = [statusCheck];
  let cleanupOk = false;
  // Hoisted above try/finally: the finally block's cleanup-count check needs
  // to know whether an insert ever happened, not just whether the checks
  // above passed.
  let row: Record<string, unknown> | null = null;

  try {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      const { rows } = await db.query(
        `select event_name, user_id, query_id, job_id, company_domain, position, props
         from intervu.telemetry_events where event_id = $1`,
        [eventId],
      );
      if (rows.length > 0) {
        row = rows[0];
        break;
      }
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }

    checks.push(runCheck("row_found", row !== null ? "found" : "absent", "found", row !== null));

    if (!row) {
      console.error(
        `[verify-telemetry-e2e] no row with event_id=${eventId} after ${RETRY_ATTEMPTS} ` +
          `attempts (~${(RETRY_ATTEMPTS * RETRY_DELAY_MS) / 1000}s)`,
      );
      console.error(await diagnoseMissingRow(db));
    } else {
      checks.push(runCheck("event_name", row.event_name, event.event_name, row.event_name === event.event_name));
      checks.push(runCheck("user_id_null", row.user_id, null, row.user_id === null));
      checks.push(runCheck("query_id", row.query_id, queryId, row.query_id === queryId));
      checks.push(runCheck("job_id", row.job_id, jobId, row.job_id === jobId));
      checks.push(
        runCheck("company_domain", row.company_domain, companyDomain, row.company_domain === companyDomain),
      );
      checks.push(runCheck("position", row.position, position, row.position === position));

      const propsLanded = (row.props ?? {}) as Record<string, unknown>;
      const propsOk = Object.entries(props).every(([k, v]) => propsLanded[k] === v);
      checks.push(runCheck("props_subset", propsLanded, props, propsOk));
    }
  } finally {
    // Expected delete count depends on whether a row ever landed — in the
    // silent-drop diagnostic path (row_found already failed above) there is
    // nothing to delete, and a 0-row DELETE there is cleanup working
    // correctly, not cleanup failing. `insertHappened` is the single place
    // that decision is made; the two branches below only differ in wording,
    // not in outcome.
    const insertHappened = row !== null;
    const { rowCount } = await db.query(`delete from intervu.telemetry_events where event_id = $1`, [eventId]);
    cleanupOk = rowCount === (insertHappened ? 1 : 0);
    if (cleanupOk && insertHappened) console.log(`PASS cleanup: deleted synthetic row event_id=${eventId}`);
    else if (cleanupOk) console.log(`PASS cleanup: no row existed to delete, nothing to clean up`);
    else console.error(`FAIL cleanup: deleted ${rowCount} row(s), expected ${insertHappened ? 1 : 0} (event_id=${eventId})`);
    await db.end();
  }

  const allChecksPassed = checks.every((c) => c.pass);
  if (!allChecksPassed || !cleanupOk) {
    throw new Error(
      `verification failed: ${checks.filter((c) => !c.pass).length} check(s) failed` +
        (cleanupOk ? "" : ", cleanup also failed"),
    );
  }

  console.log("[verify-telemetry-e2e] all checks passed");
}

// Guarded so a test can import this module for `buildMissingRowDiagnosis`
// (same convention as scripts/check-index-settings-drift.mjs) without
// running the whole script — a bare `main()` call here would fire on import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[verify-telemetry-e2e] failed:", err);
      process.exit(1);
    });
}

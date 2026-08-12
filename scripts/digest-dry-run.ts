#!/usr/bin/env node
/**
 * Prints what the weekly digest WOULD send for one user — without ever
 * calling sendEmail or advancing the digest cursor. `previewDigestForUser`
 * (src/lib/email/digest/send.ts) is the exact same code path
 * `sendDigestForUser` uses right up to the point of actually sending, so
 * this can't silently drift from what a real send would produce. This is
 * the E4 requirement: ship the endpoint + this script, no cron wired yet —
 * Vivek reviews real output here before anything runs on a schedule.
 *
 *   npx tsx scripts/digest-dry-run.ts --uid=<firebase-uid>
 *
 * Needs Firebase admin creds + a working jobs search backend. Reads
 * .env.local the same manual way scripts/apply-synonyms.mjs does (this
 * repo has no dotenv dependency) — env vars must land BEFORE the dynamic
 * import below, since several downstream modules read them at call time.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
try {
    for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
} catch {
    /* no .env.local — fine if the real env already has what's needed */
}

const uidArg = process.argv.find((a) => a.startsWith("--uid="));
const uid = uidArg?.slice("--uid=".length);
if (!uid) {
    console.error("Usage: npx tsx scripts/digest-dry-run.ts --uid=<firebase-uid>");
    process.exit(1);
}

const { previewDigestForUser } = await import("../src/lib/email/digest/send.ts");

const result = await previewDigestForUser(uid);

if ("skipped" in result) {
    console.log(`[digest dry-run] uid=${uid} — SKIPPED (${result.skipped})`);
    process.exit(0);
}

console.log(`[digest dry-run] uid=${uid} -> ${result.email}`);
console.log(`Subject: ${result.subject}`);
console.log("\n--- text ---\n");
console.log(result.text);
console.log("\n--- html ---\n");
console.log(result.html);

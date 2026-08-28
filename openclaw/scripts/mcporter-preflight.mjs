#!/usr/bin/env node
// Runs before every scheduled (cron) intervu-apply invocation — see
// install.sh's arm_cron_job, which prepends this script's invocation to
// every --system-event it registers, so a job added later inherits the
// check by construction rather than by remembering to ask for it.
//
// OpenClaw's cron API (`openclaw cron add`) has no shell-exec/pre-hook flag
// — the payload is natural-language text handed to an agent session. So this
// is not an OS-level gate; it is a script the directive instructs the agent
// to run and obey the exit code of. That is the most enforcement the
// platform offers today.
//
// Three invariants, checked in order, each failing loudly (nonzero exit, one
// line naming the heal command) rather than silently proceeding on a broken
// connection:
//   a. mcporter.json's identity fields match what install.sh would write —
//      reconcileIdentity() repairs them and reports whether either changed.
//   b. the keep-alive daemon's own record of mcporter.json's mtime matches
//      the live file — if not, it is holding a connection built from a
//      config that has since moved out from under it.
//   c. the credentials vault holds real tokens for the CURRENTLY ACTIVE
//      identity (serverKey + baseUrl) — never falls back to some other
//      identity's tokens, however plausible-looking.
//
// Never launches a browser: on any failure this hands the human a heal
// command and stops. Never prints token/secret values.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { reconcileIdentity } from "./mcporter-reconcile.mjs";

export const HEAL_COMMAND = "curl -fsSL https://intervuhq.com/install | bash";

export function mcporterHome() {
  return join(homedir(), ".mcporter");
}

// Pure decision: does the daemon's own record of mcporter.json's mtime
// still match the file on disk? `trackedMtimeMs` is `null` when there is no
// daemon metadata yet (nothing to compare against, so nothing is stale).
export function isDaemonStale(trackedMtimeMs, liveMtimeMs) {
  return trackedMtimeMs !== null && trackedMtimeMs !== liveMtimeMs;
}

// Mirrors mcporter's own OAuth vault key derivation (its oauth-vault.js,
// vaultKeyForDefinition, for an http-transport server definition:
// "<name>|" + sha256({name, url: new URL(url).toString(), command: null})
// .hex.slice(0, 16)). Reimplemented rather than imported — that module is
// mcporter's internal dist file, not a published API — verified against its
// installed source (2026-08). Depends on serverName + baseUrl only, same as
// upstream: an oauthRedirectUrl-only change reuses the same vault entry
// there, and must here too, or this would report a false "no token" on a
// config edit that never actually invalidated the credential.
export function vaultKeyFor(serverName, baseUrl) {
  const descriptor = JSON.stringify({ name: serverName, url: new URL(baseUrl).toString(), command: null });
  const hash = createHash("sha256").update(descriptor).digest("hex").slice(0, 16);
  return `${serverName}|${hash}`;
}

// Pure decision: does credentials.json hold a real access token for the
// CURRENTLY ACTIVE identity? Keyed by serverName+baseUrl hash rather than
// serverName alone (unlike scripts/viewer/mcporter-token.mjs's
// pickAccessToken, which returns on the first serverName match regardless of
// which baseUrl it was minted against) — so a stale entry for a retired
// origin, even one still holding valid-looking tokens, is never mistaken
// for the active identity's credential.
export function hasValidToken(credentials, serverName, baseUrl) {
  const entries = credentials?.entries;
  if (!entries || typeof entries !== "object") return false;
  const token = entries[vaultKeyFor(serverName, baseUrl)]?.tokens?.access_token;
  return typeof token === "string" && token.length > 0;
}

function defaultRestart() {
  try {
    execFileSync("mcporter", ["daemon", "restart"], { stdio: "ignore" });
  } catch {
    // Best-effort, matching install.sh's own step-3 restart
    // (`mcporter daemon restart >/dev/null 2>&1 || true`): a failed restart
    // here is not silently reported as success — the credential check that
    // follows is the real gate, and a stuck daemon that still can't serve a
    // valid connection will surface there instead.
  }
}

// Where the daemon records its own view of a config file's mtime — same
// derivation as mcporter's daemon/host.js (sha1 of the resolved config path,
// first 12 hex chars). Exported so tests can locate the same file this
// reads rather than re-deriving the formula a second time.
export function daemonMetadataPath(configPath) {
  const digest = createHash("sha1").update(configPath).digest("hex").slice(0, 12);
  return join(mcporterHome(), "daemon", `daemon-${digest}.json`);
}

// I/O: restarts the keep-alive daemon iff its tracked config mtime has
// drifted from the live file's mtime. Safe to call before any daemon has
// ever run (no metadata file yet — isDaemonStale treats that as "not
// stale", since there is nothing recorded to have drifted from).
export function reconcileDaemon(configPath, { restart = defaultRestart } = {}) {
  const liveMtimeMs = statSync(configPath).mtimeMs;
  const metadataPath = daemonMetadataPath(configPath);

  let trackedMtimeMs = null;
  try {
    trackedMtimeMs = JSON.parse(readFileSync(metadataPath, "utf8"))?.configMtimeMs ?? null;
  } catch {
    return;
  }
  if (isDaemonStale(trackedMtimeMs, liveMtimeMs)) restart();
}

function fail(message) {
  console.error(`${message} Run: ${HEAL_COMMAND}`);
  process.exit(1);
}

export function runPreflight(serverKey, canonicalUrl, canonicalRedirect) {
  const configPath = join(mcporterHome(), "mcporter.json");
  if (!existsSync(configPath)) {
    fail(`velai's mcporter is not set up on this machine (${configPath} is missing).`);
    return;
  }

  let identityChanged;
  try {
    identityChanged = reconcileIdentity(configPath, serverKey, canonicalUrl, canonicalRedirect);
  } catch (err) {
    fail(`could not read or repair ${configPath} (${err.message}).`);
    return;
  }
  if (identityChanged) {
    fail(
      "velai's mcporter identity had drifted from what install.sh sets up and was just corrected — " +
        "the cached connection needs one manual re-approval before this can run.",
    );
    return;
  }

  reconcileDaemon(configPath);

  let credentials;
  try {
    credentials = JSON.parse(readFileSync(join(mcporterHome(), "credentials.json"), "utf8"));
  } catch {
    fail("velai's connection needs approval before this can run — no credentials found.");
    return;
  }
  if (!hasValidToken(credentials, serverKey, canonicalUrl)) {
    fail("velai's connection needs re-approval before this can run.");
  }
}

function main() {
  const [serverKey, canonicalUrl, canonicalRedirect] = process.argv.slice(2);
  if (!serverKey || !canonicalUrl || !canonicalRedirect) {
    console.error("Usage: mcporter-preflight.mjs <serverKey> <canonicalUrl> <canonicalRedirect>");
    process.exit(1);
  }
  runPreflight(serverKey, canonicalUrl, canonicalRedirect);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

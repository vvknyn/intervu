import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    HEAL_COMMAND,
    daemonMetadataPath,
    hasValidToken,
    isDaemonStale,
    reconcileDaemon,
    vaultKeyFor,
} from "../../openclaw/scripts/mcporter-preflight.mjs";

/**
 * Every scheduled (cron) intervu-apply run is instructed to call
 * mcporter-preflight.mjs before doing anything else (see install.sh's
 * arm_cron_job / PREFLIGHT_DIRECTIVE, covered in mcporter-config.test.ts).
 * These tests cover the three invariants it enforces:
 *   (a) identity fields match what install.sh would write — that repair
 *       logic is shared with install.sh via mcporter-reconcile.mjs and is
 *       tested for behavioral equivalence in mcporter-config.test.ts, not
 *       duplicated here.
 *   (b) the daemon's own record of mcporter.json's mtime is not stale.
 *   (c) the active identity (serverKey + baseUrl, never a fallback identity)
 *       holds real tokens.
 */

const PREFLIGHT_SCRIPT = path.join(process.cwd(), "openclaw", "scripts", "mcporter-preflight.mjs");
const SERVER_KEY = "intervu-cc-mcp";
const ACTIVE_URL = "https://intervuhq.com/api/mcp";
const ACTIVE_REDIRECT = "http://127.0.0.1:21473/callback";
const STALE_URL = "https://intervu.cc/api/mcp"; // the retired 2026-08-24 origin

function tmpHome(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "mcporter-preflight-"));
    mkdirSync(path.join(dir, ".mcporter"), { recursive: true });
    return dir;
}

function writeConfig(home: string, server: Record<string, unknown>): string {
    const file = path.join(home, ".mcporter", "mcporter.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER_KEY]: server } }, null, 2));
    return file;
}

function writeCredentials(home: string, entries: Record<string, unknown>): void {
    writeFileSync(path.join(home, ".mcporter", "credentials.json"), JSON.stringify({ entries }, null, 2));
}

function tokenEntry(accessToken: string) {
    return { serverName: SERVER_KEY, tokens: { access_token: accessToken } };
}

/**
 * reconcileDaemon() locates the daemon metadata file via os.homedir(), same
 * as the module's mcporterHome(). Node reads $HOME live (verified), so this
 * temporarily repoints it at a sandbox — the only way to exercise that path
 * without ever touching the real ~/.mcporter/daemon/.
 */
function withHome<T>(home: string, fn: () => T): T {
    const original = process.env.HOME;
    process.env.HOME = home;
    try {
        return fn();
    } finally {
        if (original === undefined) delete process.env.HOME;
        else process.env.HOME = original;
    }
}

/** Runs the real CLI against a sandboxed $HOME so nothing under the actual ~/.mcporter is ever touched. */
function runCli(home: string): { status: number | null; stderr: string } {
    const { HOME: _realHome, ...cleanEnv } = process.env;
    try {
        execFileSync("node", [PREFLIGHT_SCRIPT, SERVER_KEY, ACTIVE_URL, ACTIVE_REDIRECT], {
            encoding: "utf8",
            env: { ...cleanEnv, HOME: home },
        });
        return { status: 0, stderr: "" };
    } catch (err) {
        const e = err as { status: number | null; stderr: string };
        return { status: e.status, stderr: e.stderr };
    }
}

describe("isDaemonStale", () => {
    it("is stale when the tracked mtime differs from the live one", () => {
        assert.equal(isDaemonStale(1000, 2000), true);
    });

    it("is not stale when they match", () => {
        assert.equal(isDaemonStale(1000, 1000), false);
    });

    it("is not stale when nothing has been tracked yet (no daemon metadata)", () => {
        assert.equal(isDaemonStale(null, 1000), false);
    });
});

describe("reconcileDaemon", () => {
    it("does not restart when there is no daemon metadata file yet", () => {
        const home = tmpHome();
        const configPath = writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        withHome(home, () => {
            let restarted = false;
            reconcileDaemon(configPath, { restart: () => (restarted = true) });
            assert.equal(restarted, false);
        });
    });

    it("does not restart when the tracked mtime matches the live file", () => {
        const home = tmpHome();
        const configPath = writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        withHome(home, () => {
            const metadataPath = daemonMetadataPath(configPath);
            mkdirSync(path.dirname(metadataPath), { recursive: true });
            const { mtimeMs } = statSync(configPath);
            writeFileSync(metadataPath, JSON.stringify({ configMtimeMs: mtimeMs }));
            let restarted = false;
            reconcileDaemon(configPath, { restart: () => (restarted = true) });
            assert.equal(restarted, false);
        });
    });

    it("restarts when the tracked mtime has drifted from an edit to a field unrelated to identity", () => {
        // Non-surfacing case: the drift here is a change to some OTHER server's
        // entry, not baseUrl/oauthRedirectUrl. The daemon-staleness check must
        // catch ANY drift in the file's mtime, not just identity-field edits —
        // proving it is a general content-agnostic check, not keyed to the
        // specific field that motivated this fix.
        const home = tmpHome();
        const configPath = writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        withHome(home, () => {
            const metadataPath = daemonMetadataPath(configPath);
            mkdirSync(path.dirname(metadataPath), { recursive: true });
            // Tracked metadata frozen at a point before the edit below.
            writeFileSync(metadataPath, JSON.stringify({ configMtimeMs: 1 }));
            // An edit that has nothing to do with intervu's identity fields.
            writeFileSync(
                configPath,
                JSON.stringify({
                    mcpServers: {
                        [SERVER_KEY]: { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT },
                        "some-other-server": { baseUrl: "https://example.com/mcp" },
                    },
                })
            );
            let restarted = false;
            reconcileDaemon(configPath, { restart: () => (restarted = true) });
            assert.equal(restarted, true, "any live/tracked mtime mismatch must trigger a restart, regardless of what changed");
        });
    });
});

describe("vaultKeyFor / hasValidToken", () => {
    it("keys only on serverName + baseUrl — an oauthRedirectUrl-only change must not mint a different key", () => {
        // Matches mcporter's own oauth-vault.js: the vault key derivation does
        // not take the redirect into account, so correcting a drifted redirect
        // (invariant a) must not orphan a credential that is otherwise fine.
        assert.equal(vaultKeyFor(SERVER_KEY, ACTIVE_URL), vaultKeyFor(SERVER_KEY, ACTIVE_URL));
    });

    it("a different baseUrl produces a different key", () => {
        assert.notEqual(vaultKeyFor(SERVER_KEY, ACTIVE_URL), vaultKeyFor(SERVER_KEY, STALE_URL));
    });

    it("finds a real token for the active identity", () => {
        const credentials = { entries: { [vaultKeyFor(SERVER_KEY, ACTIVE_URL)]: tokenEntry("real-token") } };
        assert.equal(hasValidToken(credentials, SERVER_KEY, ACTIVE_URL), true);
    });

    it("never falls back to a different identity's tokens, even one for the same server name", () => {
        // The exact 2026-08-24 shape: the retired origin's entry has valid
        // tokens, the active origin's entry does not exist at all.
        const credentials = { entries: { [vaultKeyFor(SERVER_KEY, STALE_URL)]: tokenEntry("stale-real-token") } };
        assert.equal(hasValidToken(credentials, SERVER_KEY, ACTIVE_URL), false);
    });

    it("picks the active identity's entry correctly even while a stale one with tokens also exists", () => {
        const credentials = {
            entries: {
                [vaultKeyFor(SERVER_KEY, STALE_URL)]: tokenEntry("stale-real-token"),
                [vaultKeyFor(SERVER_KEY, ACTIVE_URL)]: tokenEntry("active-real-token"),
            },
        };
        assert.equal(hasValidToken(credentials, SERVER_KEY, ACTIVE_URL), true);
    });

    it("treats a client-registration-only entry (PKCE state, no tokens) as no token", () => {
        // The exact failure shape this fix targets: the active identity has an
        // entry, but only client_id/PKCE state, not tokens — mcporter minted
        // the client but nobody has completed the browser approval yet.
        const credentials = { entries: { [vaultKeyFor(SERVER_KEY, ACTIVE_URL)]: { serverName: SERVER_KEY, client_id: "abc" } } };
        assert.equal(hasValidToken(credentials, SERVER_KEY, ACTIVE_URL), false);
    });

    it("rejects a missing or malformed credentials shape instead of throwing", () => {
        assert.equal(hasValidToken({}, SERVER_KEY, ACTIVE_URL), false);
        assert.equal(hasValidToken(null, SERVER_KEY, ACTIVE_URL), false);
    });
});

describe("mcporter-preflight.mjs CLI (sandboxed $HOME — never touches the real ~/.mcporter)", () => {
    it("fails loudly, naming the heal command, when mcporter.json does not exist", () => {
        const home = tmpHome();
        const { status, stderr } = runCli(home);
        assert.notEqual(status, 0);
        assert.match(stderr, new RegExp(HEAL_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    it("repairs and fails loudly on the exact 2026-08-24 shape (old unpinned port, new origin already set)", () => {
        const home = tmpHome();
        const configPath = writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: "http://127.0.0.1:33445/callback" });
        const { status, stderr } = runCli(home);
        assert.notEqual(status, 0);
        assert.match(stderr, /re-approval|drifted/i);
        const repaired = JSON.parse(readFileSync(configPath, "utf8"));
        assert.equal(
            repaired.mcpServers[SERVER_KEY].oauthRedirectUrl,
            ACTIVE_REDIRECT,
            "must self-heal the file even though it also fails loudly — a human re-running install.sh should find it already fixed"
        );
    });

    it("repairs and fails loudly on an arbitrary wrong redirect port that is neither 33445 nor the pin", () => {
        // Non-surfacing case #2: the class fix must catch ANY redirect drift,
        // not just the specific historical port from the incident that
        // motivated this fix.
        const home = tmpHome();
        const configPath = writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: "http://127.0.0.1:9999/callback" });
        const { status } = runCli(home);
        assert.notEqual(status, 0);
        const repaired = JSON.parse(readFileSync(configPath, "utf8"));
        assert.equal(repaired.mcpServers[SERVER_KEY].oauthRedirectUrl, ACTIVE_REDIRECT);
    });

    it("fails loudly when there is no credentials.json at all", () => {
        const home = tmpHome();
        writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        const { status, stderr } = runCli(home);
        assert.notEqual(status, 0);
        assert.match(stderr, /credentials/i);
    });

    it("fails loudly when only a retired identity's tokens exist — never falls back to them", () => {
        const home = tmpHome();
        writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        writeCredentials(home, { [vaultKeyFor(SERVER_KEY, STALE_URL)]: tokenEntry("stale-real-token") });
        const { status, stderr } = runCli(home);
        assert.notEqual(status, 0);
        assert.match(stderr, /re-approval/i);
        assert.doesNotMatch(stderr, /stale-real-token/, "must never print a token value");
    });

    it("succeeds silently (exit 0) when identity is already correct and the active identity has a real token", () => {
        const home = tmpHome();
        writeConfig(home, { baseUrl: ACTIVE_URL, oauthRedirectUrl: ACTIVE_REDIRECT });
        writeCredentials(home, { [vaultKeyFor(SERVER_KEY, ACTIVE_URL)]: tokenEntry("active-real-token") });
        const { status, stderr } = runCli(home);
        assert.equal(status, 0);
        assert.doesNotMatch(stderr, /active-real-token/, "must never print a token value");
    });
});

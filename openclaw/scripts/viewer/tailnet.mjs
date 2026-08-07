/**
 * Detects, sets up, and verifies the Tailscale link that lets a watch
 * session cross onto cellular (D9). The address predicate and the marker
 * file are load-bearing for `transport-lan.mjs` (labels a URL "tailnet" vs
 * "lan") and for `viewer.mjs` (decides whether to print WATCH-ANYWHERE or
 * the JIT setup offer instead) — both import from here rather than
 * duplicating the range or the path.
 */

import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MARKER_PATH = join(homedir(), ".openclaw", "viewer-tailnet-ready");

/** CGNAT range 100.64.0.0/10 — the block Tailscale assigns its own addresses from. */
export function isTailnetAddress(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    const octets = parts.map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = octets;
    return a === 100 && b >= 64 && b <= 127;
}

/** Strips the IPv4-mapped-in-IPv6 prefix Node reports on some sockets
 *  (`::ffff:100.64.0.1`) so the same dotted-quad predicate above still
 *  recognizes it. */
export function stripV4MappedPrefix(address) {
    return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/**
 * Whether the LOCAL side of a connection — the interface it arrived on,
 * e.g. `req.socket.localAddress` — is the tailnet. This is the one fact
 * that decides whether a LAN-transport connection may send input (control)
 * rather than only watch: the product installs on other people's networks,
 * and a plain same-WiFi link (café, office guest network) must stay
 * watch-only. Built on the same `isTailnetAddress` range check
 * transport-lan.mjs already uses to label an outbound URL "tailnet" vs
 * "lan", so there is exactly one definition of "on the tailnet" for both
 * jobs — no second address list to keep in sync.
 */
export function isTailnetConnection(localAddress) {
    return isTailnetAddress(stripV4MappedPrefix(localAddress ?? ""));
}

export function tailnetReady() {
    return existsSync(MARKER_PATH);
}

/** No mobile peer waits this long by itself — someone has to install the
 *  app and sign in on the phone — but a silent hang is the one outcome
 *  with no diagnosis, so setup gives up loudly rather than never. */
export const TAILNET_TIMEOUT_MS = 10 * 60 * 1000;

const AUTH_URL_RE = /https:\/\/login\.tailscale\.com\/a\/\S+/;

/** Parses `tailscale status --json`'s stdout, or null if it isn't valid
 *  JSON. Used both to decide whether the daemon is reachable at all — any
 *  parseable status (Running, NeedsLogin, Stopped, ...) is proof enough,
 *  independent of exit code, which Tailscale doesn't use consistently
 *  across those states — and to read the fields the callers below need. */
function parseTailnetStatus(statusJson) {
    try {
        return JSON.parse(statusJson);
    } catch {
        return null;
    }
}

function isMobilePeerOnline(statusJson) {
    const status = parseTailnetStatus(statusJson);
    return Object.values(status?.Peer ?? {}).some((p) => (p?.OS === "iOS" || p?.OS === "android") && p?.Online === true);
}

/** Real shell-out, used only by the CLI entry point below — every test
 *  drives `setup()` with its own scripted stub instead. */
async function realRun(cmd, args, { onStdout } = {}) {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let child;
        try {
            child = spawn(cmd, args);
        } catch (error) {
            return resolve({ code: -1, stdout: "", stderr: String(error) });
        }
        child.stdout?.on("data", (chunk) => { const s = chunk.toString(); stdout += s; onStdout?.(s); });
        // tailscale logs its auth URL to stderr on some versions, so the
        // scraper has to see both streams, not just stdout.
        child.stderr?.on("data", (chunk) => { const s = chunk.toString(); stderr += s; onStdout?.(s); });
        child.on("error", (error) => resolve({ code: -1, stdout, stderr: stderr || String(error) }));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings the tailnet link up and waits for a phone to join before declaring
 * it ready. The first thing this does is ask Tailscale for its own status —
 * that succeeds identically whether the daemon was started by brew, the
 * macOS App Store app, the standalone pkg installer, or a Linux package
 * manager, so it is the one true test of "is this usable," never an inferred
 * fact about which install method put it there. Install and daemon-start
 * only run when that probe says the tailnet genuinely isn't reachable yet.
 * Every shell-out goes through the injected `run` so no test ever spawns a
 * real process.
 *
 * @param {object} deps
 * @param {(cmd: string, args: string[], opts?: {onStdout?: (chunk: string) => void}) => Promise<{code: number, stdout: string, stderr: string}>} deps.run
 * @param {string} [deps.markerPath]
 * @param {string} [deps.platform]  defaults to the real process.platform
 * @param {number} [deps.deadlineMs]  how long to wait for a mobile peer
 * @param {(ms: number) => Promise<void>} [deps.sleepImpl]
 */
// Exiting the process is the CLI wrapper's job, not this function's — a
// unit test calls setup() directly, in the same process as every other
// test, and must not have its outcome decided by a shared process.exitCode.
// Failure paths log the label the skill/human needs and then throw.
export async function setup({ run, markerPath = MARKER_PATH, platform = process.platform, deadlineMs = TAILNET_TIMEOUT_MS, sleepImpl = defaultSleep }) {
    // This probe IS the fix: the previous round made `brew services start`
    // unconditional on darwin, which hard-fails setup on the App Store app
    // and the standalone pkg — both fully working installs brew has never
    // heard of. Parseable JSON back from `tailscale status --json` is proof
    // the daemon is reachable, independent of exit code and independent of
    // which of brew, the App Store app, the standalone pkg, or a Linux
    // package manager put it there. Only unparseable output — nothing
    // installed, no socket, nothing to talk to — means install/daemon-start
    // actually need to run.
    const probe = await run("tailscale", ["status", "--json"]);
    let status = parseTailnetStatus(probe.stdout);

    if (!status) {
        const installed = await run("which", ["tailscale"]);
        if (installed.code !== 0) {
            const { cmd, args } = platform === "darwin"
                ? { cmd: "brew", args: ["install", "tailscale"] }
                : { cmd: "sh", args: ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"] };
            const install = await run(cmd, args);
            if (install.code !== 0) {
                console.error(`Could not install Tailscale (exit ${install.code}). ${install.stderr}`.trim());
                throw new Error("tailscale install failed");
            }
        }

        // brew's tailscale formula does not register or start the
        // tailscaled launchd service the way every other install path does
        // — only reached now because the probe above already proved
        // nothing answered, so this can no longer misfire against an App
        // Store/standalone install whose daemon was reachable all along.
        if (platform === "darwin") {
            const daemon = await run("brew", ["services", "start", "tailscale"]);
            if (daemon.code !== 0) {
                console.error(`Could not start the Tailscale daemon (exit ${daemon.code}). ${daemon.stderr}`.trim());
                throw new Error("tailscale daemon start failed");
            }
        }
        // A fresh install/daemon-start has nothing authenticated yet —
        // `tailscale up` below decides; there's no status left to trust.
        status = null;
    }

    // Already-Running means already authenticated — `tailscale up` would
    // just reconfirm it and has no new auth URL to print, so a node in this
    // state skips straight to waiting for the mobile peer below.
    if (status?.BackendState !== "Running") {
        const up = await run("tailscale", ["up"], {
            onStdout: (chunk) => {
                const match = chunk.match(AUTH_URL_RE);
                if (match) console.log(`TAILNET-AUTH-URL: ${match[0]}`);
            },
        });
        // Previously discarded: a failed `up` (no daemon, no network, an
        // auth error with no matchable URL) fell straight into the
        // 10-minute "waiting for a mobile peer" poll and only ever reported
        // TAILNET-TIMEOUT — a failure knowable in this instant, reported ten
        // minutes late with no cause. Any non-zero step here fails loudly.
        if (up.code !== 0) {
            console.error(`'tailscale up' failed (exit ${up.code}). ${up.stderr}`.trim());
            throw new Error("tailscale up failed");
        }
    }

    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        const poll = await run("tailscale", ["status", "--json"]);
        if (isMobilePeerOnline(poll.stdout)) {
            mkdirSync(dirname(markerPath), { recursive: true });
            writeFileSync(markerPath, "");
            console.log("TAILNET-READY");
            return;
        }
        await sleepImpl(2000);
    }
    console.error("TAILNET-TIMEOUT");
    throw new Error("no mobile peer came online before the deadline");
}

// CLI entry: `node scripts/viewer/tailnet.mjs setup`. Guarded so importing
// this module (transport-lan.mjs, viewer.mjs) never runs it as a script, and
// wrapped rather than top-level-awaited so the module still loads under
// tooling (this repo's test runner among them) that transforms it as CJS.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    if (process.argv[2] === "setup") {
        setup({ run: realRun }).catch(() => { process.exitCode = 1; });
    } else {
        console.error("Usage: node scripts/viewer/tailnet.mjs setup");
        process.exitCode = 1;
    }
}

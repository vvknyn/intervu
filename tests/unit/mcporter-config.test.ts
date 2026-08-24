import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The installer runs `curl -fsSL <origin>/install | bash` with no
 * repo checkout on disk, so its mcporter-config logic has to live inline in
 * install.sh — it cannot import a module we could unit-test directly. Rather
 * than restate that logic here (a copy that would silently drift from the
 * copy that actually ships), these tests extract the real block from
 * install.sh between its markers and execute it. If someone edits the
 * installer, these tests exercise the edit.
 */
const INSTALL_SH = path.join(process.cwd(), "openclaw", "install.sh");
const SKILL_MD = path.join(process.cwd(), "openclaw", "SKILL.md");

function installerSource(): string {
    return readFileSync(INSTALL_SH, "utf8");
}

/** Pulls the JS program out of the marked `node -e '...'` block in install.sh. */
function extractConfigPatchProgram(): string {
    const source = installerSource();
    const start = source.indexOf("# --- >>> mcporter-config-patch");
    const end = source.indexOf("# --- <<< mcporter-config-patch");
    assert.ok(start !== -1 && end > start, "mcporter-config-patch markers missing from install.sh");
    const block = source.slice(start, end);
    const match = /node -e '([\s\S]*?)'\s*"\$MCPORTER_CONFIG"/.exec(block);
    assert.ok(match, "could not find the node -e program inside the marked block");
    return match[1];
}

/**
 * Every plain `NAME="value"` assignment in install.sh, resolved the way bash
 * will resolve it.
 *
 * A regex read is not enough any more: the installer derives every intervu URL
 * from a single `INTERVU_BASE`, so reading `MCP_SERVER_URL` textually returns
 * the literal `$INTERVU_BASE/api/mcp` — a string that is not a URL, and one
 * these tests would happily compare against itself while proving nothing about
 * the origin that actually ships. Letting bash expand them means the test reads
 * the same values a person running the installer gets.
 *
 * Assignments containing a command substitution are skipped: the point is to
 * read constants, not to execute the installer.
 */
const RESOLVED_VARS: Readonly<Record<string, string>> = (() => {
    const assignments = installerSource()
        .split("\n")
        .filter((line) => /^[A-Z_][A-Z0-9_]*="[^"`]*"$/.test(line) && !line.includes("$("));
    const names = assignments.map((line) => line.slice(0, line.indexOf("=")));
    const echoes = names.map((n) => `printf '%s\\n' "\${${n}}"`).join("\n");
    // INTERVU_BASE removed so an override exported in the shell running the
    // tests can't change what they assert — the subject is the DEFAULT that
    // ships. Everything else is passed through, because bash still needs a
    // usable environment to run in.
    const { INTERVU_BASE: _overridden, ...cleanEnv } = process.env;
    const out = execFileSync("bash", ["-c", `${assignments.join("\n")}\n${echoes}`], {
        encoding: "utf8",
        env: cleanEnv,
    });
    const values = out.split("\n");
    return Object.fromEntries(names.map((n, i) => [n, values[i]]));
})();

function installerVar(name: string): string {
    const value = RESOLVED_VARS[name];
    assert.ok(value, `install.sh is missing a ${name} assignment`);
    return value;
}

/**
 * Linux commonly allocates ephemeral ports from 32768 (macOS from 49152), so a
 * pin at or above this can be handed to another process between runs. Shared by
 * the installer guard and the SKILL.md guard below so the doc and the value it
 * describes cannot drift apart.
 */
const EPHEMERAL_FLOOR = 32768;

/**
 * The `## MCP server` section — the only part of SKILL.md that owns the pin
 * contract. Scoped deliberately: SKILL.md legitimately names other loopback
 * ports (the resume-preview servers), and a file-wide check would flag those.
 */
function mcpSection(): string {
    const skill = readFileSync(SKILL_MD, "utf8");
    const heading = "## MCP server";
    const start = skill.indexOf(heading);
    assert.ok(start !== -1, "SKILL.md is missing its '## MCP server' section");
    const rest = skill.slice(start + heading.length);
    const end = rest.search(/^## /m);
    return end === -1 ? rest : rest.slice(0, end);
}

const SERVER_KEY = installerVar("MCP_SERVER_KEY");
const SERVER_URL = installerVar("MCP_SERVER_URL");
const OAUTH_PORT = installerVar("MCP_OAUTH_PORT");
const REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/callback`;

type McporterServer = { baseUrl?: string; lifecycle?: string; oauthRedirectUrl?: string };
type McporterConfig = { mcpServers: Record<string, McporterServer> };
type PatchResult = { config: McporterConfig; stdout: string; identityChanged: boolean };

/**
 * Writes `initial` to a temp mcporter.json, runs the extracted program over it,
 * returns the result. `serverUrl` is a parameter because the point of several of
 * these cases is an install whose stored origin is NOT the one shipping today.
 */
function runPatch(initial: unknown, redirect: string = REDIRECT, serverUrl: string = SERVER_URL): PatchResult {
    const dir = mkdtempSync(path.join(tmpdir(), "mcporter-config-"));
    const file = path.join(dir, "mcporter.json");
    writeFileSync(file, JSON.stringify(initial, null, 2));
    const stdout = execFileSync(
        "node",
        ["-e", extractConfigPatchProgram(), file, SERVER_KEY, serverUrl, redirect],
        { encoding: "utf8" }
    );
    return {
        config: JSON.parse(readFileSync(file, "utf8")),
        stdout,
        identityChanged: stdout.includes("IDENTITY_CHANGED"),
    };
}

describe("installer mcporter config patch", () => {
    it("pins the callback and reports the change on an install that predates the pin", () => {
        const { config, identityChanged } = runPatch({
            mcpServers: { [SERVER_KEY]: { baseUrl: SERVER_URL, lifecycle: "keep-alive" } },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(
            identityChanged,
            true,
            "must signal IDENTITY_CHANGED so the installer passes --reset and clears the stale registration"
        );
    });

    it("is a no-op on an install already matching, and does NOT ask for a reset", () => {
        const { config, identityChanged } = runPatch({
            mcpServers: {
                [SERVER_KEY]: { baseUrl: SERVER_URL, lifecycle: "keep-alive", oauthRedirectUrl: REDIRECT },
            },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(
            identityChanged,
            false,
            "re-running the installer must not throw away a working credential"
        );
    });

    it("migrates an install pinned to some other port", () => {
        const { config, identityChanged } = runPatch({
            mcpServers: {
                [SERVER_KEY]: {
                    baseUrl: SERVER_URL,
                    lifecycle: "keep-alive",
                    oauthRedirectUrl: "http://127.0.0.1:52045/callback",
                },
            },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(identityChanged, true);
    });

    it("moves an install still pointed at a previous intervu origin", () => {
        // The 2026-08-24 case. Step 3's `grep -q … || mcporter config add` skips
        // registration entirely once the key exists, so this block is the ONLY
        // thing that can move an existing install — and before it wrote baseUrl,
        // re-running the installer left the stale origin in place and reported
        // success. An MCP client compares the URL it was given against the
        // `.well-known` documents it fetches, so a stale origin fails the
        // handshake on an issuer mismatch that names nothing.
        const { config, identityChanged } = runPatch({
            mcpServers: {
                [SERVER_KEY]: {
                    baseUrl: "https://previous-origin.example/api/mcp",
                    lifecycle: "keep-alive",
                    oauthRedirectUrl: REDIRECT,
                },
            },
        });
        assert.equal(
            config.mcpServers[SERVER_KEY].baseUrl,
            SERVER_URL,
            "an existing install must be moved to the shipping origin, not left where it was"
        );
        assert.equal(
            identityChanged,
            true,
            "the cached client_id was minted against the old origin's authorization server, so it must be reset"
        );
    });

    it("creates the server entry when it is missing entirely", () => {
        const { config, identityChanged } = runPatch({ mcpServers: {} });
        const server = config.mcpServers[SERVER_KEY];
        assert.equal(server.baseUrl, SERVER_URL);
        assert.equal(server.oauthRedirectUrl, REDIRECT);
        assert.equal(server.lifecycle, "keep-alive");
        assert.equal(identityChanged, true);
    });

    it("tolerates a config with no mcpServers key at all", () => {
        const { config } = runPatch({});
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
    });

    it("always sets the keep-alive lifecycle, including when it was wrong", () => {
        const { config } = runPatch({
            mcpServers: { [SERVER_KEY]: { baseUrl: SERVER_URL, lifecycle: "on-demand" } },
        });
        assert.equal(config.mcpServers[SERVER_KEY].lifecycle, "keep-alive");
    });

    it("leaves other servers in the config untouched", () => {
        const { config } = runPatch({
            mcpServers: {
                [SERVER_KEY]: { baseUrl: SERVER_URL },
                "some-other-server": { baseUrl: "https://example.com/mcp", lifecycle: "on-demand" },
            },
        });
        assert.deepEqual(config.mcpServers["some-other-server"], {
            baseUrl: "https://example.com/mcp",
            lifecycle: "on-demand",
        });
    });
});

describe("installer callback port", () => {
    it("sits outside the ephemeral range the OS allocates from", () => {
        const port = Number(OAUTH_PORT);
        assert.ok(Number.isInteger(port), "MCP_OAUTH_PORT must be an integer");
        assert.ok(port > 1024, "must not need root to bind");
        // A pinned port inside the OS ephemeral range can be handed to another
        // process between runs, which would break auth with EADDRINUSE.
        assert.ok(port < EPHEMERAL_FLOOR, `pinned port ${port} is inside an OS ephemeral range`);
    });

    it("is never quoted as a literal in SKILL.md, so an agent cannot 'correct' a differing pin", () => {
        const found = /(?:127\.0\.0\.1|localhost):\d+/.exec(mcpSection())?.[0];
        assert.equal(
            found,
            undefined,
            `SKILL.md's MCP server section must not name a concrete callback port (found ${found}). ` +
                "install.sh is the single source of that value. A literal here invites an agent to rewrite " +
                "a working pin so it matches the doc, which mints a new client_id and forces the daily " +
                "browser approval this pin exists to prevent."
        );
    });

    it("states the pin contract in SKILL.md: the key, the do-not-touch rule, the reset, and the same floor", () => {
        const section = mcpSection();
        assert.match(section, /oauthRedirectUrl/, "SKILL.md must name the key the agent has to preserve");
        assert.match(
            section,
            /do not "correct" the port/i,
            "SKILL.md must tell the agent to leave a differing pin alone, not just to keep the key present"
        );
        assert.match(section, /--reset/, "SKILL.md must document the one-time --reset recovery");
        assert.match(
            section,
            new RegExp(`below ${EPHEMERAL_FLOOR}\\b`),
            `SKILL.md must quote the same ephemeral floor (${EPHEMERAL_FLOOR}) the installer is held to`
        );
    });

    it("passes --reset only when the identity changed", () => {
        const source = installerSource();
        assert.match(
            source,
            /if \[ "\$AUTH_IDENTITY_STATE" = "IDENTITY_CHANGED" \]; then\s+AUTH_RESET="--reset"/,
            "the --reset must stay conditional; unconditional reset discards a working credential every re-run"
        );
    });
});

describe("installer origin", () => {
    it("derives every intervu URL from one origin", () => {
        // The MCP handshake compares the URL in a person's config against the
        // `.well-known` documents it fetches. A second origin spelled anywhere
        // in this script is a second answer to "who is intervu", and the failure
        // it produces names neither the file nor the mismatch.
        const base = installerVar("INTERVU_BASE");
        assert.equal(installerVar("MCP_SERVER_URL"), `${base}/api/mcp`);
        assert.equal(installerVar("HELP_URL"), `${base}/connect/help`);
        assert.equal(installerVar("SKILL_TARBALL_URL"), `${base}/intervu-apply-skill.tar.gz`);
    });

    it("installs against the same origin the MCP server identifies as", () => {
        // THE cross-file link, and the one this whole class needed: install.sh
        // writes MCP_SERVER_URL into a person's mcporter config, while the
        // server answers `.well-known` requests with AGENT.issuer(). Those are
        // two files, in two languages, that no reviewer reads together — and an
        // MCP client rejects the handshake when they disagree, naming neither.
        //
        // Read via a child process because AGENT.issuer() consults the
        // environment, and the assertion is about the DEFAULT that ships: what
        // someone gets when nothing is configured.
        const { AGENT_ISSUER_URL: _configured, ...issuerDefaultEnv } = process.env;
        const issuer = execFileSync(
            "npx",
            [
                "tsx",
                "-e",
                'import { AGENT } from "./src/lib/agent/config"; process.stdout.write(AGENT.issuer());',
            ],
            { encoding: "utf8", cwd: process.cwd(), env: issuerDefaultEnv }
        ).trim();
        assert.equal(
            installerVar("INTERVU_BASE"),
            issuer,
            "install.sh points people at an origin the MCP server does not identify as"
        );
    });
});

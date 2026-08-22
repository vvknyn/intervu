import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The installer runs `curl -fsSL https://intervu.cc/install | bash` with no
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

/** Reads a `NAME="value"` assignment out of install.sh. */
function installerVar(name: string): string {
    const match = new RegExp(`^${name}="([^"]*)"`, "m").exec(installerSource());
    assert.ok(match, `install.sh is missing a ${name} assignment`);
    return match[1];
}

const SERVER_KEY = installerVar("MCP_SERVER_KEY");
const SERVER_URL = installerVar("MCP_SERVER_URL");
const OAUTH_PORT = installerVar("MCP_OAUTH_PORT");
const REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/callback`;

type McporterServer = { baseUrl?: string; lifecycle?: string; oauthRedirectUrl?: string };
type McporterConfig = { mcpServers: Record<string, McporterServer> };
type PatchResult = { config: McporterConfig; stdout: string; redirectChanged: boolean };

/** Writes `initial` to a temp mcporter.json, runs the extracted program over it, returns the result. */
function runPatch(initial: unknown, redirect: string = REDIRECT): PatchResult {
    const dir = mkdtempSync(path.join(tmpdir(), "mcporter-config-"));
    const file = path.join(dir, "mcporter.json");
    writeFileSync(file, JSON.stringify(initial, null, 2));
    const stdout = execFileSync(
        "node",
        ["-e", extractConfigPatchProgram(), file, SERVER_KEY, SERVER_URL, redirect],
        { encoding: "utf8" }
    );
    return {
        config: JSON.parse(readFileSync(file, "utf8")),
        stdout,
        redirectChanged: stdout.includes("REDIRECT_CHANGED"),
    };
}

describe("installer mcporter config patch", () => {
    it("pins the callback and reports the change on an install that predates the pin", () => {
        const { config, redirectChanged } = runPatch({
            mcpServers: { [SERVER_KEY]: { baseUrl: SERVER_URL, lifecycle: "keep-alive" } },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(
            redirectChanged,
            true,
            "must signal REDIRECT_CHANGED so the installer passes --reset and clears the stale registration"
        );
    });

    it("is a no-op on an already-pinned install and does NOT ask for a reset", () => {
        const { config, redirectChanged } = runPatch({
            mcpServers: {
                [SERVER_KEY]: { baseUrl: SERVER_URL, lifecycle: "keep-alive", oauthRedirectUrl: REDIRECT },
            },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(
            redirectChanged,
            false,
            "re-running the installer must not throw away a working credential"
        );
    });

    it("migrates an install pinned to some other port", () => {
        const { config, redirectChanged } = runPatch({
            mcpServers: {
                [SERVER_KEY]: {
                    baseUrl: SERVER_URL,
                    lifecycle: "keep-alive",
                    oauthRedirectUrl: "http://127.0.0.1:52045/callback",
                },
            },
        });
        assert.equal(config.mcpServers[SERVER_KEY].oauthRedirectUrl, REDIRECT);
        assert.equal(redirectChanged, true);
    });

    it("creates the server entry when it is missing entirely", () => {
        const { config, redirectChanged } = runPatch({ mcpServers: {} });
        const server = config.mcpServers[SERVER_KEY];
        assert.equal(server.baseUrl, SERVER_URL);
        assert.equal(server.oauthRedirectUrl, REDIRECT);
        assert.equal(server.lifecycle, "keep-alive");
        assert.equal(redirectChanged, true);
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
        // macOS allocates ephemeral ports from 49152; Linux commonly from 32768.
        // A pinned port inside either range can be handed to another process
        // between runs, which would break auth with EADDRINUSE.
        assert.ok(port < 32768, `pinned port ${port} is inside an OS ephemeral range`);
    });

    it("is documented in SKILL.md with the same value the installer writes", () => {
        const skill = readFileSync(SKILL_MD, "utf8");
        assert.ok(
            skill.includes(REDIRECT),
            `SKILL.md must document the pinned callback ${REDIRECT} so the agent does not strip it`
        );
    });

    it("passes --reset only when the pin changed", () => {
        const source = installerSource();
        assert.match(
            source,
            /if \[ "\$REDIRECT_STATE" = "REDIRECT_CHANGED" \]; then\s+AUTH_RESET="--reset"/,
            "the --reset must stay conditional; unconditional reset discards a working credential every re-run"
        );
    });
});

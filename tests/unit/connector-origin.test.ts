import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mcpConnectorUrl, openclawInstallCommand, setupSteps } from "../../src/components/marketing/openclaw-content";

/**
 * An MCP connector fails silently when the URL a person pastes and the origin
 * the `.well-known` documents name are not the same. Until 2026-08-24 the
 * pasted URL was three hand-typed string literals in a marketing module while
 * the metadata came from `AGENT.issuer()` — two sources for one fact, and the
 * kind that can't be caught by reading either file alone.
 *
 * These guard the SHAPE: every displayed connector string is a function of the
 * issuer, and no surface spells an origin itself.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** Any absolute origin literal, so a NEW wrong domain is caught too — not just
 *  the retired one that surfaced this. */
const ORIGIN_LITERAL = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i;

/** Files that show a connector URL or command to a person. */
const CONNECTOR_SURFACES = [
    "src/components/marketing/openclaw-content.ts",
    "src/app/connect/connect-client.tsx",
    "src/app/connect/help/page.tsx",
    "src/app/openclaw/page.tsx",
];

const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("connector origin: one source, no hand-typed copies", () => {
    it("every displayed connector string is built from the issuer it is given", () => {
        const issuer = "https://example.test";
        assert.equal(mcpConnectorUrl(issuer), "https://example.test/api/mcp");
        assert.match(openclawInstallCommand(issuer), /https:\/\/example\.test\/install/);
        const authCommand = setupSteps(issuer).find((s) => s.command)?.command;
        assert.ok(authCommand, "the setup steps should still carry a copyable auth command");
        assert.match(authCommand, /https:\/\/example\.test\/api\/mcp/);
    });

    it("no connector surface spells an origin of its own", () => {
        for (const path of CONNECTOR_SURFACES) {
            const src = stripComments(read(path));
            const hit = src.match(ORIGIN_LITERAL);
            assert.equal(
                hit,
                null,
                `${path} hardcodes ${hit?.[0]} — it must take the origin from AGENT.issuer() instead`,
            );
        }
    });

    it("the retired domain is gone from all of them", () => {
        // The case that surfaced it, kept as its own assertion so a regression
        // names the actual domain rather than a generic "origin literal".
        for (const path of CONNECTOR_SURFACES) {
            assert.doesNotMatch(read(path), /intervu\.cc/, `${path} still points at the retired intervu.cc`);
        }
    });

    it("the origin probe can actually detect an origin", () => {
        // Without this the file-scan above would pass on any string at all.
        assert.match("https://intervu.cc/api/mcp", ORIGIN_LITERAL);
        assert.match("curl -fsSL https://intervuhq.com/install | bash", ORIGIN_LITERAL);
        assert.doesNotMatch("`${issuer}/api/mcp`", ORIGIN_LITERAL);
    });
});

describe("connect page: the sign-in step exists and returns", () => {
    const PAGE = read("src/app/connect/page.tsx");
    const CLIENT = read("src/app/connect/connect-client.tsx");

    it("the page resolves sign-in on the server, not after paint", () => {
        // A client-side auth listener would render the signed-out state first
        // and then swap, which on a setup page reads as a flash of wrong advice.
        assert.match(PAGE, /getServerUser\(\)/, "the connect page must read the session server-side");
        assert.match(PAGE, /signedIn=\{/, "and pass it down rather than letting the client guess");
    });

    it("a signed-out visitor is offered sign-in, and sent back here afterwards", () => {
        assert.match(CLIENT, /data-testid="connect-signin-step"/, "the sign-out branch must render something");
        assert.match(CLIENT, /!signedIn\s*&&/, "and it must be conditional on being signed out");
        const link = CLIENT.match(/\/login\?next=\$\{encodeURIComponent\("([^"]+)"\)\}/);
        assert.ok(link, "the sign-in link must carry a next= so setup resumes");
        assert.equal(link[1], "/connect", "it must return to this page, not a generic landing");
    });

    it("that return path is actually allowed by the post-auth validator", () => {
        // The case OTHER than the one reported: a next= the validator rejects
        // silently drops the visitor on /jobs, which looks identical to having
        // no sign-in step at all. Both connector return paths are checked.
        const routes = read("src/lib/auth/product-routes.ts");
        const safe = routes.slice(routes.indexOf("SAFE_POST_AUTH_PREFIXES"), routes.indexOf("] as const", routes.indexOf("SAFE_POST_AUTH_PREFIXES")));
        for (const path of ["/connect", "/oauth/authorize"]) {
            assert.match(safe, new RegExp(`"${path}"`), `${path} must be a safe post-auth return, or sign-in loses the setup`);
        }
    });
});

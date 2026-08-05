/**
 * Borrows the credential mcporter already holds.
 *
 * The doorbell needs a bearer token, and the user has already granted one:
 * `mcporter auth intervu-cc-mcp` runs during install and its OAuth tokens
 * live in ~/.mcporter/credentials.json. Reading it there is what keeps the
 * spec's hard constraint — no new prompt, account, or login — literally true.
 *
 * The trade is a coupling to another tool's on-disk format. That is why the
 * shape check below is strict and returns null instead of improvising: a
 * changed format must degrade to same-WiFi viewing with a clear message, not
 * produce a token-shaped value that fails confusingly at the server.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MCPORTER_CREDENTIALS = join(homedir(), ".mcporter", "credentials.json");

/**
 * Entries are keyed "<serverName>|<hash>", so the key cannot be constructed —
 * the serverName field is the only reliable way in.
 *
 * @param {unknown} credentials Parsed credentials.json.
 * @param {string} serverName   As registered by install.sh, e.g. "intervu-cc-mcp".
 * @returns {string|null}
 */
export function pickAccessToken(credentials, serverName) {
    const entries = credentials && typeof credentials === "object" ? credentials.entries : null;
    if (!entries || typeof entries !== "object") return null;
    for (const entry of Object.values(entries)) {
        if (entry?.serverName !== serverName) continue;
        const token = entry.tokens?.access_token;
        return typeof token === "string" && token ? token : null;
    }
    return null;
}

/**
 * @param {string} serverName
 * @param {string} [path]
 * @returns {string|null} null when the file is absent, unreadable, or has no
 *   entry for this server — every case means "no remote viewing", never a
 *   thrown error that would take the apply loop down with it.
 */
export function readAccessToken(serverName, path = MCPORTER_CREDENTIALS) {
    try {
        return pickAccessToken(JSON.parse(readFileSync(path, "utf8")), serverName);
    } catch {
        return null;
    }
}

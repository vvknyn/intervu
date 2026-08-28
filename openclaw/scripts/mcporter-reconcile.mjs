#!/usr/bin/env node
// The identity-repair half of install.sh's step 3 (mcporter-config-patch),
// ported so a scheduled run can call it too, not just a human re-running the
// installer. install.sh cannot import this file back (curl|bash has no repo
// checkout to import from — see its own header comment), so the two copies
// are kept in lockstep by tests/unit/mcporter-config.test.ts asserting they
// transform an identical fixture identically, not by a shared import.
//
// Behavior must stay byte-for-byte equivalent to install.sh's `node -e`
// block (lines ~299-311): same fields written, same unconditional overwrite
// (so a run that predates any of these fields still gets healed), same
// IDENTITY_CHANGED signal derived from comparing baseUrl/oauthRedirectUrl
// only — not lifecycle, which is metadata rather than part of the OAuth
// client identity.

import { readFileSync, writeFileSync } from "node:fs";

/**
 * Rewrites the given MCP server's identity fields in mcporter.json to the
 * canonical values, unconditionally (heals a config that predates any of
 * these fields, exactly like a re-run of install.sh would).
 *
 * @param {string} configPath
 * @param {string} serverKey
 * @param {string} canonicalUrl
 * @param {string} canonicalRedirect
 * @returns {boolean} true iff baseUrl or oauthRedirectUrl actually changed —
 *   i.e. the cached OAuth client registration on disk no longer matches what
 *   it was minted against and needs a human to re-approve it.
 */
export function reconcileIdentity(configPath, serverKey, canonicalUrl, canonicalRedirect) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.mcpServers = config.mcpServers || {};
  const server = config.mcpServers[serverKey] || (config.mcpServers[serverKey] = {});
  const before = [server.baseUrl, server.oauthRedirectUrl];
  server.lifecycle = "keep-alive";
  server.baseUrl = canonicalUrl;
  server.oauthRedirectUrl = canonicalRedirect;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return before[0] !== canonicalUrl || before[1] !== canonicalRedirect;
}

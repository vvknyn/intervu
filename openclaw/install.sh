#!/usr/bin/env bash
set -euo pipefail

# intervu-apply — installer
#
# Registers the intervu MCP server with mcporter, authenticates it, copies
# this skill directory into OpenClaw's skills dir, restarts the gateway, and
# arms the two cron jobs the skill relies on (morning digest + weekly
# recap). Every step below is safe to re-run: it checks current state first
# and no-ops if already done.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="intervu-apply"
MCP_SERVER_KEY="intervu-cc-mcp"
MCPORTER_CONFIG="$HOME/.mcporter/mcporter.json"

# --- 1. OpenClaw must already be installed ---------------------------------
echo "==> Checking OpenClaw is installed..."
if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw not found — install it first: https://docs.openclaw.ai"
  exit 1
fi
echo "    OpenClaw found."

# --- 2. mcporter (install if missing) ---------------------------------------
echo "==> Checking mcporter is installed..."
command -v mcporter >/dev/null 2>&1 || npm i -g mcporter
echo "    mcporter ready."

# --- 3. Register the intervu MCP server (idempotent) ------------------------
echo "==> Registering the intervu MCP server ($MCP_SERVER_KEY)..."
grep -q "$MCP_SERVER_KEY" "$MCPORTER_CONFIG" 2>/dev/null || \
  mcporter config add "$MCP_SERVER_KEY" --url https://intervu.cc/api/mcp --config "$MCPORTER_CONFIG"
echo "    Registered."

# --- 4. Auth (opens a browser window) ---------------------------------------
echo "==============================================================="
echo "  A browser window is about to open for you to approve intervu."
echo "  YOU HAVE ABOUT 60 SECONDS — be ready to click through it now."
echo "==============================================================="
mcporter auth "$MCP_SERVER_KEY"
echo "    Auth flow complete."

# --- 5. Install the skill ----------------------------------------------------
echo "==> Installing the skill..."
INSTALL_DIR="$HOME/.openclaw/skills/$SKILL_NAME"
# ~/.openclaw/skills/ — NOT ~/.openclaw/workspace/skills/ — is the directory
# OpenClaw actually injects into the agent's context; the workspace skills
# dir is never read by the gateway. This is a verified, hard-won finding, not
# a guess — installing anywhere else silently produces an agent that doesn't
# have this skill.
rm -rf "$INSTALL_DIR"
if command -v rsync >/dev/null 2>&1; then
  mkdir -p "$INSTALL_DIR"
  rsync -a --exclude='.git' "$SCRIPT_DIR"/ "$INSTALL_DIR"
else
  echo "    rsync not found — falling back to cp -R (a .git directory, if this checkout has one, will be copied too)."
  cp -R "$SCRIPT_DIR" "$INSTALL_DIR"
fi
echo "    Installed to $INSTALL_DIR."

# --- 6. Restart the gateway so the newly installed skill is picked up -------
echo "==> Restarting the OpenClaw gateway..."
GATEWAY_LABEL="ai.openclaw.gateway"
if [[ "$OSTYPE" == "darwin"* ]] && launchctl print "gui/$(id -u)/$GATEWAY_LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$GATEWAY_LABEL"
  echo "    Gateway restarted."
else
  echo "    Could not restart the gateway automatically — restart your OpenClaw gateway manually for the skill to take effect."
fi

# --- 7. Arm the cron jobs (idempotent) ---------------------------------------
echo "==> Arming cron jobs..."
EXISTING_CRON="$(openclaw cron list 2>/dev/null || true)"

if echo "$EXISTING_CRON" | grep -q "intervu-apply-digest"; then
  echo "    intervu-apply-digest already exists, skipping."
else
  openclaw cron add --name intervu-apply-digest --schedule "0 8 * * *" \
    --session main --system-event "Run the intervu-apply morning digest (SKILL.md §1)."
  echo "    intervu-apply-digest armed."
fi

if echo "$EXISTING_CRON" | grep -q "intervu-apply-recap"; then
  echo "    intervu-apply-recap already exists, skipping."
else
  openclaw cron add --name intervu-apply-recap --schedule "0 18 * * 0" \
    --session main --system-event "Run the intervu-apply weekly recap (SKILL.md §6)."
  echo "    intervu-apply-recap armed."
fi

# --- 8. Done ------------------------------------------------------------------
echo
echo "Send /new to your agent on WhatsApp, then ask it to find you jobs."

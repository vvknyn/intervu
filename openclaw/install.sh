#!/usr/bin/env bash
set -euo pipefail

# intervu-apply — installer
#
# Registers the intervu MCP server with mcporter, authenticates it, downloads
# and installs this skill into OpenClaw's skills dir, restarts the gateway,
# and arms the two cron jobs the skill relies on (morning digest + weekly
# recap). Every step below is safe to re-run: it checks current state first
# and no-ops if already done.
#
# Designed to run as: curl -fsSL https://intervu.cc/install | bash
# There is no script file on disk in that mode, so this deliberately never
# references $0/$BASH_SOURCE or a repo checkout.

SKILL_NAME="intervu-apply"
MCP_SERVER_KEY="intervu-cc-mcp"
MCPORTER_CONFIG="$HOME/.mcporter/mcporter.json"
SKILL_TARBALL_URL="https://intervu.cc/intervu-apply-skill.tar.gz"

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
mcporter auth "$MCP_SERVER_KEY" || {
  echo "Auth failed. Re-run 'mcporter auth $MCP_SERVER_KEY' — make sure you click through the browser prompt within ~60 seconds this time."
  exit 1
}
echo "    Auth flow complete."

# --- 5. Install the skill ----------------------------------------------------
echo "==> Downloading and installing the skill..."
INSTALL_DIR="$HOME/.openclaw/skills/$SKILL_NAME"
# ~/.openclaw/skills/ — NOT ~/.openclaw/workspace/skills/ — is the directory
# OpenClaw actually injects into the agent's context; the workspace skills
# dir is never read by the gateway. This is a verified, hard-won finding, not
# a guess — installing anywhere else silently produces an agent that doesn't
# have this skill.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! curl -fsSL "$SKILL_TARBALL_URL" -o "$TMP_DIR/skill.tar.gz"; then
  echo "Failed to download the skill payload from $SKILL_TARBALL_URL — aborting without touching $INSTALL_DIR."
  exit 1
fi

mkdir -p "$TMP_DIR/skill"
tar -xzf "$TMP_DIR/skill.tar.gz" -C "$TMP_DIR/skill"

if [[ ! -f "$TMP_DIR/skill/SKILL.md" ]]; then
  echo "Downloaded skill payload is missing SKILL.md — aborting without touching $INSTALL_DIR."
  exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$TMP_DIR/skill" "$INSTALL_DIR"
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
  openclaw cron add --name intervu-apply-digest --cron "0 8 * * *" \
    --session main --system-event "Run the intervu-apply morning digest (SKILL.md §1)."
  echo "    intervu-apply-digest armed."
fi

if echo "$EXISTING_CRON" | grep -q "intervu-apply-recap"; then
  echo "    intervu-apply-recap already exists, skipping."
else
  openclaw cron add --name intervu-apply-recap --cron "0 18 * * 0" \
    --session main --system-event "Run the intervu-apply weekly recap (SKILL.md §6)."
  echo "    intervu-apply-recap armed."
fi

# --- 8. Done ------------------------------------------------------------------
echo
echo "Send /new to your agent on WhatsApp, then ask it to find you jobs."

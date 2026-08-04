#!/usr/bin/env bash
set -euo pipefail

# The gateway takes a few seconds to accept connections after a restart —
# any scheduler/cron command fired too early dies with "gateway closed
# (1006)". Poll until it answers (caught live on the first real user
# walkthrough, 2026-08-03).
wait_for_gateway() {
  for _ in $(seq 1 15); do
    if openclaw cron list >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "    Gateway did not come back within 30s — run 'openclaw gateway status', then re-run this installer." >&2
  return 1
}


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

# --- 1. OpenClaw must be installed and onboarded ----------------------------
echo "==> Checking OpenClaw is installed..."
if command -v openclaw >/dev/null 2>&1; then
  echo "    OpenClaw found."
else
  echo "OpenClaw not found — installing it now (npm i -g openclaw)."
  npm i -g openclaw
  echo "    OpenClaw installed."

  echo "==> Handing off to OpenClaw's own onboarding wizard..."
  echo "    Model provider, API keys, and channel/WhatsApp linking are its call —"
  echo "    this installer does not automate any of that, just launches it."
  # Under curl|bash, stdin is the pipe, not a terminal, so the wizard can't
  # read prompts from it — re-attach it to /dev/tty (the standard pattern for
  # interactive installers run this way). Probe openability in a subshell
  # first (a plain `-r /dev/tty` file-permission check can read true even
  # with no controlling terminal, e.g. under CI, since it only checks
  # permission bits on the device node, not whether it can actually be
  # opened; the subshell keeps the probe's fds from leaking into the rest of
  # this script either way).
  if ( exec 2>/dev/null 3<>/dev/tty ); then
    openclaw onboard < /dev/tty || {
      echo "OpenClaw onboarding did not finish. Once you're ready, run 'openclaw onboard' yourself, then re-run: curl -fsSL https://intervu.cc/install | bash"
      exit 1
    }
    echo "    Onboarding complete."
  else
    echo "No interactive terminal available here to run the OpenClaw onboarding wizard."
    echo "Run these two commands yourself once you have a real terminal:"
    echo "  openclaw onboard"
    echo "  curl -fsSL https://intervu.cc/install | bash"
    exit 1
  fi
fi

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
wait_for_gateway
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

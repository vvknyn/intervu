#!/usr/bin/env bash
set -euo pipefail

# Every intervu URL in this script derives from this one origin, and it must be
# the SAME origin the MCP server identifies as (`AGENT.issuer()`,
# src/lib/agent/config.ts). That is not cosmetic: `MCP_SERVER_URL` below is
# written into the user's own mcporter config, and an MCP client compares it
# against the `.well-known` documents it fetches. Point them at two different
# hostnames — even two that redirect to each other — and the handshake fails
# with an issuer mismatch rather than anything that names the cause.
# Overridable so a staging origin can be installed against without editing.
INTERVU_BASE="${INTERVU_BASE:-https://intervuhq.com}"

HELP_URL="$INTERVU_BASE/connect/help"
# Every fatal exit below calls this so a stuck user always has a next step
# beyond re-reading a terminal error.
help_link() {
  echo "    More help: $HELP_URL#$1"
}

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
  help_link gateway >&2
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
# Designed to run as: curl -fsSL $INTERVU_BASE/install | bash
# There is no script file on disk in that mode, so this deliberately never
# references $0/$BASH_SOURCE or a repo checkout.

SKILL_NAME="intervu-apply"
MCP_SERVER_KEY="intervu-cc-mcp"
MCP_SERVER_URL="$INTERVU_BASE/api/mcp"
MCPORTER_CONFIG="$HOME/.mcporter/mcporter.json"
SKILL_TARBALL_URL="$INTERVU_BASE/intervu-apply-skill.tar.gz"

# Pinning mcporter's OAuth callback to a fixed loopback port is what makes the
# connection last. By default mcporter binds the callback to port 0 — a new
# ephemeral port every run — then notices the redirect URI changed, discards
# the cached client registration, and re-registers, minting a NEW client_id.
# Our refresh endpoint requires a refresh token to be presented by the client
# it was issued to (`refreshAccess`, src/lib/agent/oauth.ts), so an unpinned
# callback makes refresh structurally impossible: every run falls back to a
# full browser approval. Users saw this as "why do I have to reconnect every
# morning?" — the daily cron was simply the first thing to touch the dead
# connection each day.
#
# 21473 is below the ephemeral range macOS allocates from (49152-65535,
# verified via net.inet.ip.portrange.first) and below the common Linux default
# (32768), so the OS will not hand this port to some other process behind our
# back. It is only bound for the seconds an auth flow is in progress.
MCP_OAUTH_PORT="21473"
MCP_OAUTH_REDIRECT="http://127.0.0.1:${MCP_OAUTH_PORT}/callback"

# resolve_node_lts()'s fallback when nodejs.org is unreachable or its
# index.json shape changes. This was the current LTS release verified
# 2026-08-07 — update it if that drifts far from reality, but it only ever
# matters when the live lookup below already failed.
NODE_LTS_FALLBACK="v24.19.0"

# Picks the newest LTS release from nodejs.org's release index. The file is
# a JSON array, newest release first, one object per line, with "lts" either
# false (a Current, non-LTS build) or a codename string — so among the lines
# that carry a "version" (skipping the bare "[" array opener, which otherwise
# satisfies a plain inverse match and yields nothing), the first without
# "lts":false is the release we want. No jq or node available yet at this
# point, hence grep/sed instead of a real JSON parser.
resolve_node_lts() {
  local json ver
  json="$(curl -fsSL --max-time 10 https://nodejs.org/dist/index.json 2>/dev/null)" || true
  if [ -n "$json" ]; then
    ver="$(printf '%s\n' "$json" | grep '"version":' | grep -v '"lts":false' | head -1 | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  fi
  echo "${ver:-$NODE_LTS_FALLBACK}"
}

# Makes sure `npm` is on PATH before anything below needs it. A real-user
# failure (2026-08-06): a fresh Mac with no npm died at `npm i -g openclaw`
# with a bare "command not found", and the only remediation anyone had ever
# written down was developer-speak (nvm, brew, nodejs.org). This installer
# now sets Node up itself instead of telling the user to.
#
# The runtime lands in a user-owned prefix ($HOME/.openclaw/runtime), never
# system-wide, so nothing here — or the `npm i -g openclaw` that follows —
# ever needs sudo.
ensure_node() {
  command -v npm >/dev/null 2>&1 && return 0

  local runtime_bin="$HOME/.openclaw/runtime/current/bin"
  if [ -x "$runtime_bin/npm" ]; then
    export PATH="$runtime_bin:$PATH"
    return 0
  fi

  if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "This needs Node.js installed first, and this installer can only set that up automatically on a Mac."
    help_link install-node
    exit 1
  fi

  echo "==> Setting up the runtime this needs (about a minute)..."

  local arch
  case "$(uname -m)" in
    arm64)  arch="arm64" ;;
    x86_64) arch="x64" ;;
    *)
      echo "This Mac's processor type ($(uname -m)) isn't one this installer knows how to set up automatically."
      help_link install-node
      exit 1
      ;;
  esac

  local ver dl_dir tarball sums
  ver="$(resolve_node_lts)"
  dl_dir="$(mktemp -d)"
  tarball="node-$ver-darwin-$arch.tar.gz"

  if ! curl -fsSL "https://nodejs.org/dist/$ver/$tarball" -o "$dl_dir/$tarball"; then
    echo "Could not download the runtime this needs."
    help_link install-node
    exit 1
  fi

  sums="$(curl -fsSL "https://nodejs.org/dist/$ver/SHASUMS256.txt" 2>/dev/null | grep -F " $tarball")"
  if [ -z "$sums" ] || ! (cd "$dl_dir" && printf '%s\n' "$sums" | shasum -a 256 -c -) >/dev/null 2>&1; then
    echo "The downloaded runtime failed verification — not proceeding."
    help_link install-node
    exit 1
  fi

  mkdir -p "$HOME/.openclaw/runtime"
  tar -xzf "$dl_dir/$tarball" -C "$HOME/.openclaw/runtime"
  rm -rf "$dl_dir"
  ln -sfn "$HOME/.openclaw/runtime/node-$ver-darwin-$arch" "$HOME/.openclaw/runtime/current"

  export PATH="$runtime_bin:$PATH"

  local marker="# intervu installer: local Node runtime"
  if ! grep -qF "$marker" "$HOME/.zprofile" 2>/dev/null; then
    {
      echo "$marker"
      echo "export PATH=\"\$HOME/.openclaw/runtime/current/bin:\$PATH\""
    } >> "$HOME/.zprofile"
  fi

  echo "    Runtime ready."
}

# Reports when npm gave us an older release than the current one.
#
# npm does that silently whenever Node is too old for the current release, and
# the consequence surfaces much later and in the wrong place: OpenClaw's
# onboarding fails with "plugin requires plugin API >= X, but this runtime
# exposes Y", which blames the plugin and never mentions Node. Found on a
# from-scratch install (2026-08-05): Node 22.20.0 quietly yielded openclaw
# 2026.6.34 instead of 2026.7.1-2, and WhatsApp could not be connected at all.
#
# Both the current version and its Node requirement are read from npm rather
# than restated here, so this cannot drift when either package bumps and it
# works for any package we install rather than one named one. The caller
# decides how serious it is, because that differs per package.
#
# Returns 1 when outdated, 0 when current OR when it cannot tell (offline, or
# the package isn't where npm says it should be) — an unreachable registry
# must never be the thing that stops someone installing.
warn_if_outdated() {
  local pkg="$1" want got engines root
  want="$(npm view "$pkg" version 2>/dev/null)" || return 0
  [ -n "$want" ] || return 0
  root="$(npm root -g 2>/dev/null)" || return 0
  got="$(node -e "try{console.log(require('$root/$pkg/package.json').version)}catch(e){}" 2>/dev/null)"
  [ -n "$got" ] || return 0
  [ "$want" != "$got" ] || return 0

  engines="$(npm view "$pkg@$want" engines.node 2>/dev/null || true)"
  echo
  echo "    $pkg $got was installed, but $want is the current release."
  echo "    Node $(node -v) cannot run $want${engines:+ (it needs Node $engines)},"
  echo "    so npm quietly installed the older one instead."
  return 1
}

# --- 0. Node/npm must exist before anything below can run -------------------
ensure_node

# --- 1. OpenClaw must be installed and onboarded ----------------------------
echo "==> Checking OpenClaw is installed..."
if command -v openclaw >/dev/null 2>&1; then
  echo "    OpenClaw found."
else
  echo "OpenClaw not found — installing it now (npm i -g openclaw)."
  npm i -g openclaw
  echo "    OpenClaw installed."
  NEEDS_ONBOARD=1
fi

# Deliberately BEFORE onboarding, and outside the branch above so it also
# catches an OpenClaw that was already installed and has since gone stale.
# Onboarding is exactly where a too-old runtime fails, so checking afterwards
# would let someone sit through the wizard, pair nothing, and read an error
# about plugin API versions that never mentions the actual cause.
if ! warn_if_outdated openclaw; then
  echo "    Without the current OpenClaw, the WhatsApp plugin will not install"
  echo "    and your agent will have no way to reach you."
  echo
  echo "    Upgrade Node, then re-run:  curl -fsSL $INTERVU_BASE/install | bash"
  echo "    (nodejs.org, or 'brew upgrade node', or 'nvm install --lts')"
  help_link node-version
  exit 1
fi

if [ "${NEEDS_ONBOARD:-}" = "1" ]; then
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
      echo "OpenClaw onboarding did not finish. Once you're ready, run 'openclaw onboard' yourself, then re-run: curl -fsSL $INTERVU_BASE/install | bash"
      help_link onboarding
      exit 1
    }
    echo "    Onboarding complete."
  else
    echo "No interactive terminal available here to run the OpenClaw onboarding wizard."
    echo "Run these two commands yourself once you have a real terminal:"
    echo "  openclaw onboard"
    echo "  curl -fsSL $INTERVU_BASE/install | bash"
    help_link onboarding
    exit 1
  fi
fi

# --- 2. mcporter (install if missing) ---------------------------------------
echo "==> Checking mcporter is installed..."
command -v mcporter >/dev/null 2>&1 || npm i -g mcporter
echo "    mcporter ready."

# Advisory, not fatal: an older mcporter still authenticates and still serves
# the MCP tools, so this is worth knowing about but not worth blocking on.
warn_if_outdated mcporter || echo "    Not fatal — the intervu tools work on this version."

# --- 3. Register the intervu MCP server (idempotent) ------------------------
echo "==> Registering the intervu MCP server ($MCP_SERVER_KEY)..."
grep -q "$MCP_SERVER_KEY" "$MCPORTER_CONFIG" 2>/dev/null || \
  mcporter config add "$MCP_SERVER_KEY" --url "$MCP_SERVER_URL" --config "$MCPORTER_CONFIG"
echo "    Registered."

# Keep the MCP connection warm — without this every tool call pays a full
# cold handshake (~4.4s measured); with the daemon it drops to ~1s. The
# lifecycle field is what `mcporter daemon` auto-detects. Node does this
# edit (not python3) because Node is guaranteed present by this point in
# the script and python3 is not — on a fresh Mac, invoking python3 pops
# Apple's "install developer tools?" dialog, which nothing here is waiting
# on and nobody would know to click through.
# The same pass pins the OAuth callback port (see MCP_OAUTH_REDIRECT above)
# and the server's own URL.
#
# Those two values together are the identity the cached OAuth client was
# registered against: mcporter mints a client_id for a given server origin
# with a given redirect URI, and the authorization server will honour that
# credential for neither if either half moves. So this reports one signal —
# IDENTITY_CHANGED — rather than watching the redirect alone, which is what it
# used to do. Watching half an identity is how the 2026-08-24 origin move
# would have silently broken every existing install: `mcporter config add` in
# step 3 is skipped once the key exists, so nothing else in this script would
# ever have rewritten a stale baseUrl, and re-running the installer — the one
# thing anyone would try — would have been a no-op on exactly the field that
# was wrong.
#
# Every setting is written unconditionally so re-running the installer repairs
# an install that predates any of them.
# --- >>> mcporter-config-patch (extracted verbatim by tests/unit/mcporter-config.test.ts)
AUTH_IDENTITY_STATE="$(node -e '
  const fs = require("fs");
  const [p, key, url, redirect] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.mcpServers = d.mcpServers || {};
  const server = d.mcpServers[key] || (d.mcpServers[key] = {});
  const before = [server.baseUrl, server.oauthRedirectUrl];
  server.lifecycle = "keep-alive";
  server.baseUrl = url;
  server.oauthRedirectUrl = redirect;
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  if (before[0] !== url || before[1] !== redirect) console.log("IDENTITY_CHANGED");
' "$MCPORTER_CONFIG" "$MCP_SERVER_KEY" "$MCP_SERVER_URL" "$MCP_OAUTH_REDIRECT")"
# --- <<< mcporter-config-patch
mcporter daemon restart >/dev/null 2>&1 || true
echo "    Connection keep-alive daemon started."

# --- 4. Auth (opens a browser window) ---------------------------------------
echo "==============================================================="
echo "  A browser window is about to open for you to approve intervu."
echo "  YOU HAVE ABOUT 60 SECONDS — be ready to click through it now."
help_link auth
echo "==============================================================="
# --reset only when the identity that credential was minted against just
# changed — either half of it. Two ways an install arrives here stale:
# it predates the callback pin, so its cached registration names some long-dead
# ephemeral port (mcporter only self-clears a stale registration while the port
# is dynamic — once pinned it keeps the stale one and every auth attempt is
# rejected); or it was installed against a previous intervu origin, so the
# credential belongs to an authorization server we are no longer talking to.
# Clearing once, at the moment we move it, is what heals both; on a fresh
# install there is nothing cached and this is a no-op. Do NOT make this
# unconditional: it would throw away a working credential on every re-run.
AUTH_RESET=""
if [ "$AUTH_IDENTITY_STATE" = "IDENTITY_CHANGED" ]; then
  AUTH_RESET="--reset"
fi

mcporter auth "$MCP_SERVER_KEY" $AUTH_RESET || {
  echo "Auth failed. Re-run 'mcporter auth $MCP_SERVER_KEY' — make sure you click through the browser prompt within ~60 seconds this time."
  echo "If it failed instantly rather than timing out, something else may be holding port $MCP_OAUTH_PORT;"
  echo "check with 'lsof -nP -iTCP:$MCP_OAUTH_PORT -sTCP:LISTEN' and free it, or change oauthRedirectUrl in $MCPORTER_CONFIG."
  help_link auth
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
  help_link skill-download
  exit 1
fi

mkdir -p "$TMP_DIR/skill"
tar -xzf "$TMP_DIR/skill.tar.gz" -C "$TMP_DIR/skill"

if [[ ! -f "$TMP_DIR/skill/SKILL.md" ]]; then
  echo "Downloaded skill payload is missing SKILL.md — aborting without touching $INSTALL_DIR."
  help_link skill-download
  exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$TMP_DIR/skill" "$INSTALL_DIR"
echo "    Installed to $INSTALL_DIR."

# Phone viewing needs a pure-JS WebRTC stack. Installed here rather than
# vendored into the tarball so the download stays small and the build is not
# platform-specific, and necessarily AFTER extraction because skill install
# is rm-then-mv and would wipe it.
#
# Degrades instead of failing: viewing from a phone is a convenience, and a
# missing dependency must never block the thing the user actually installed
# this for. Same-WiFi viewing needs nothing beyond Node and still works.
echo "==> Installing skill dependencies..."
if npm install --prefix "$INSTALL_DIR" --omit=dev --silent >/dev/null 2>&1; then
  echo "    Done."
else
  echo "    Could not install them — phone viewing will fall back to same-WiFi only."
fi

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

# openclaw's cron API takes natural-language text, not a shell-exec/pre-hook
# (there is no such flag — see `openclaw cron add --help`), so the only lever
# for gating a scheduled run on config health is instructing the agent to run
# a check and obey its exit code. Routing every job through this ONE
# PREFLIGHT_DIRECTIVE — via arm_cron_job below, rather than each job composing
# its own --system-event by hand — is what makes a job added later inherit
# the check by construction instead of by remembering to ask for it.
#
# mcporter-preflight.mjs carries the actual invariants (identity drift, stale
# daemon, missing tokens for the active identity); this only wires jobs
# through it. It ships under the installed skill dir (openclaw/scripts/ is
# packaged into the skill tarball by scripts/prebuild-openclaw.mjs — unlike
# install.sh itself, which that same script excludes), so it exists on disk
# by the time any cron job fires, without install.sh needing to reference its
# own checkout (it has none in curl|bash mode).
#
# On failure the directive tells the agent to relay the script's one-line
# stderr message and stop — no retry, no browser — matching SKILL.md's
# "Unattended runs cannot self-heal" / "Two strikes, then speak" rules for
# every other failure mode a cron-triggered run can hit.
PREFLIGHT_SCRIPT="$INSTALL_DIR/scripts/mcporter-preflight.mjs"
PREFLIGHT_DIRECTIVE="Before doing anything else, run: node \"$PREFLIGHT_SCRIPT\" \"$MCP_SERVER_KEY\" \"$MCP_SERVER_URL\" \"$MCP_OAUTH_REDIRECT\" — if it exits nonzero, send its stderr line as your only reply and stop (do not retry, do not open a browser). Otherwise,"

arm_cron_job() {
  local name="$1" cron_expr="$2" task="$3"
  if echo "$EXISTING_CRON" | grep -q "$name"; then
    echo "    $name already exists, skipping."
  else
    openclaw cron add --name "$name" --cron "$cron_expr" \
      --session main --system-event "$PREFLIGHT_DIRECTIVE $task"
    echo "    $name armed."
  fi
}

arm_cron_job intervu-apply-digest "0 8 * * *" "run the intervu-apply morning digest (SKILL.md §1)."
arm_cron_job intervu-apply-recap "0 18 * * 0" "run the intervu-apply weekly recap (SKILL.md §6)."

# --- 8. Done ------------------------------------------------------------------
echo
echo "Send /new to your agent on WhatsApp, then ask it to find you jobs."

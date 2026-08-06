#!/usr/bin/env bash
set -euo pipefail

# new-user-shell.sh — simulates a brand-new user's machine so
# openclaw/install.sh can be safety-tested without touching the real
# developer's ~/.openclaw, WhatsApp pairing state, global npm packages, or
# ~/.mcporter.
#
# How isolation works: install.sh derives every path it writes from $HOME
# ($HOME/.openclaw/skills/..., $HOME/.mcporter/mcporter.json) or from npm's
# global-install prefix ($(npm root -g), via `npm i -g`). mcporter's own
# source (dist/config/path-discovery.js, dist/daemon/paths.js,
# dist/oauth-vault.js) resolves its config/daemon/credentials paths off
# os.homedir(), which itself reads $HOME on POSIX — so overriding HOME
# alone isolates mcporter completely. On top of that we set mcporter's and
# openclaw's own explicit override vars (MCPORTER_CONFIG,
# MCPORTER_DAEMON_DIR, OPENCLAW_STATE_DIR — confirmed by reading their
# dist source) as belt-and-suspenders, since they take priority over the
# homedir fallback and are the "correct" way to point each tool at a
# sandbox rather than relying on homedir() plumbing to do it right.
#
# LAUNCHD ISOLATION — closed by a PATH shim, not an env var:
# install.sh:207-213 restarts the OpenClaw gateway with
#   launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"
# launchd jobs are addressed by OS user id + a literal label string, so no
# environment variable can redirect that call away from the REAL gateway
# on a dev box. Instead the sandbox puts its own `launchctl` first on
# PATH: `print` reports not-found — which is the TRUTHFUL answer on a
# brand-new user's machine (no gateway registered yet), so install.sh
# takes its genuine fresh-install branch — and every other subcommand is
# logged to $SANDBOX_DIR/shim.log and swallowed. The real launchd is
# unreachable from inside the sandbox, by construction.
#
# Usage:
#   new-user-shell.sh [--keep] [sandbox-dir] [command...]
# Convention: after --keep is stripped (it may appear anywhere), the FIRST
# remaining arg is always the sandbox dir (or omitted for the default
# /tmp/openclaw-new-user-<timestamp>), and any further args are joined and
# run as one command via `bash -c` inside the sandbox instead of dropping
# into an interactive shell.
#   new-user-shell.sh                          # default dir, interactive
#   new-user-shell.sh /tmp/foo                  # custom dir, interactive
#   new-user-shell.sh /tmp/foo 'echo hi'         # custom dir, one command
#
# --keep only suppresses the exit-time "how to delete this" reminder — the
# script never auto-deletes the sandbox either way, --keep or not.

if ! command -v node >/dev/null 2>&1; then
  echo "new-user-shell.sh: 'node' not found on PATH — install Node first (this script does not sandbox Node itself, only npm globals and HOME-rooted config)." >&2
  exit 1
fi

# --- strip --keep (may appear anywhere), then take dir + command --------
KEEP=0
args=()
for a in "$@"; do
  if [[ "$a" == "--keep" ]]; then
    KEEP=1
  else
    args+=("$a")
  fi
done

SANDBOX_DIR="${args[0]:-/tmp/openclaw-new-user-$(date +%s)}"
[[ "${#args[@]}" -gt 0 ]] && args=("${args[@]:1}")

mkdir -p "$SANDBOX_DIR"
SANDBOX_HOME="$SANDBOX_DIR/home"
SANDBOX_NPM_PREFIX="$SANDBOX_DIR/npm-global"
mkdir -p "$SANDBOX_HOME" "$SANDBOX_NPM_PREFIX"

# --- single source of truth: every env var this sandbox overrides -------
# Parallel arrays (not an associative array — this must run under macOS's
# stock /bin/bash 3.2, which has no `declare -A`), indexed together. Add a
# var in exactly one place and both the export loop and the print loop
# below pick it up — nothing to keep in sync by hand.
SANDBOX_VAR_NAMES=(
  HOME
  npm_config_prefix
  OPENCLAW_STATE_DIR
  MCPORTER_CONFIG
  MCPORTER_DAEMON_DIR
)
SANDBOX_VAR_VALUES=(
  "$SANDBOX_HOME"
  "$SANDBOX_NPM_PREFIX"
  "$SANDBOX_HOME/.openclaw"
  "$SANDBOX_HOME/.mcporter/mcporter.json"
  "$SANDBOX_HOME/.mcporter"
)

for i in "${!SANDBOX_VAR_NAMES[@]}"; do
  export "${SANDBOX_VAR_NAMES[$i]}=${SANDBOX_VAR_VALUES[$i]}"
done

# Shim dir first (launchctl interception), then the sandbox npm-prefix
# bin (openclaw, mcporter, once `npm i -g` puts them there), then an
# ALLOWLIST of bare system dirs — never the inherited PATH. Inheriting
# PATH let the developer's real openclaw (/usr/local/bin) and mcporter
# (~/.npm-global/bin) leak into the sandbox, and install.sh said "found"
# and skipped the exact fresh-install branches this harness exists to
# test (seen live 2026-08-06). A fresh user has NO user-installed
# binaries: allowlisting system dirs models that by construction instead
# of blocklisting whatever tool names we happen to know about.
mkdir -p "$SANDBOX_DIR/bin"
export SANDBOX_SHIM_LOG="$SANDBOX_DIR/shim.log"
cat > "$SANDBOX_DIR/bin/launchctl" <<'SHIM'
#!/usr/bin/env bash
# Sandbox shim — see LAUNCHD ISOLATION note in new-user-shell.sh.
echo "launchctl-shim: $*" >> "${SANDBOX_SHIM_LOG:-/dev/null}"
[[ "${1:-}" == "print" ]] && exit 1
exit 0
SHIM
chmod +x "$SANDBOX_DIR/bin/launchctl"

SYS_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
if [[ -x "$SANDBOX_DIR/node/bin/node" ]]; then
  # Full fidelity: the sandbox brings its own Node (extract a nodejs.org
  # tarball to $SANDBOX_DIR/node), so no user-writable dir is on PATH.
  export PATH="$SANDBOX_DIR/bin:$SANDBOX_NPM_PREFIX/bin:$SANDBOX_DIR/node/bin:$SYS_PATH"
else
  # Reduced fidelity: the real node's dir must ride along, and anything
  # else installed there rides along with it. Say so, loudly.
  NODE_DIR="$(dirname "$(command -v node)")"
  echo "WARNING: no sandbox node at $SANDBOX_DIR/node/bin/node — putting $NODE_DIR on PATH. Anything else installed there leaks into the sandbox and breaks fresh-install fidelity. For a faithful run, extract a Node tarball to $SANDBOX_DIR/node first." >&2
  export PATH="$SANDBOX_DIR/bin:$SANDBOX_NPM_PREFIX/bin:$NODE_DIR:$SYS_PATH"
fi

print_entry_info() {
  echo "=== openclaw new-user sandbox ==="
  echo "sandbox dir: $SANDBOX_DIR"
  for i in "${!SANDBOX_VAR_NAMES[@]}"; do
    echo "  ${SANDBOX_VAR_NAMES[$i]}=${SANDBOX_VAR_VALUES[$i]}"
  done
  echo "  PATH prepended with: $SANDBOX_DIR/bin (launchctl shim) : $SANDBOX_NPM_PREFIX/bin"
  echo "  launchctl: $(command -v launchctl) (shimmed — real launchd unreachable; log: \$SANDBOX_DIR/shim.log)"
  echo "  node: $(command -v node || echo 'not found')"
  echo "  npm:  $(command -v npm || echo 'not found')"
  echo "  npx:  $(command -v npx || echo 'not found')"
  echo "  openclaw: $(command -v openclaw || echo 'not found (fresh ✓)')"
  echo "  mcporter: $(command -v mcporter || echo 'not found (fresh ✓)')"
  echo "This shell/dir is disposable — nothing here is your real ~/.openclaw or ~/.mcporter."
  echo "=================================="
}

print_delete_reminder() {
  echo "Done. Delete this sandbox whenever you like:  rm -rf $SANDBOX_DIR"
}

print_entry_info

if [[ "${#args[@]}" -eq 0 ]]; then
  # Interactive path: exec replaces this process, so nothing after exec
  # ever runs — print the delete reminder now, not at some later "exit"
  # this script will never see.
  [[ $KEEP -eq 1 ]] || print_delete_reminder
  exec bash -i
else
  set +e
  bash -c "${args[*]}"
  status=$?
  set -e
  [[ $KEEP -eq 1 ]] || print_delete_reminder
  exit "$status"
fi

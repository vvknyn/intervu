#!/usr/bin/env bash
# Deploy intervu to Contabo via docker compose (Caddy + Next standalone).
# Run FROM the Contabo box after git pull, with .env.production in place.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.production ]]; then
  echo "ERROR: missing $ROOT/.env.production (copy from .env.local)" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not installed. On Contabo:" >&2
  echo "  curl -fsSL https://get.docker.com | sh" >&2
  echo "  sudo usermod -aG docker \$USER  # then re-login" >&2
  exit 1
fi

docker compose pull caddy
docker compose up -d --build --remove-orphans
docker compose ps
echo "OK — check https://velai.app (DNS must point at this host first)."

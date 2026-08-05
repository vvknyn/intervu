#!/usr/bin/env bash
# Ken Burns + crossfade loop builder for how-it-works videos.
# Usage: ./build-loops.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KF="$ROOT/how-it-works-keyframes"
OUT="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FPS=24
W=1920
H=1080
HOLD=3.2      # seconds per beat
XFADE=0.5     # crossfade duration
ZOOM_END=1.08
FRAMES=$(( $(printf '%.0f' "$(echo "$HOLD * $FPS" | bc -l)") ))

segment() {
  local input="$1"
  local output="$2"
  ffmpeg -y -hide_banner -loglevel error \
    -loop 1 -i "$input" \
    -vf "scale=8000:-1,zoompan=z='min(zoom+0.0012,${ZOOM_END})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=${W}x${H}:fps=${FPS},format=yuv420p" \
    -t "$HOLD" -c:v libx264 -pix_fmt yuv420p "$output"
}

xfade_chain() {
  local n=$1
  local out="$2"
  shift 2
  local inputs=("$@")

  if (( n == 1 )); then
    cp "${inputs[0]}" "$out"
    return
  fi

  local filter=""
  local prev="0:v"
  local step
  step=$(echo "$HOLD - $XFADE" | bc -l)

  for (( i=1; i<n; i++ )); do
    local label="v${i}"
    local offset
    offset=$(echo "$step * $i" | bc -l)
    if (( i == n-1 )); then
      label="outv"
    fi
    filter+="[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${label}];"
    prev="$label"
  done
  filter="${filter%;}"

  local -a cmd=(ffmpeg -y -hide_banner -loglevel error)
  for f in "${inputs[@]}"; do
    cmd+=(-i "$f")
  done
  cmd+=(-filter_complex "$filter" -map "[outv]" -c:v libx264 -pix_fmt yuv420p "$out")
  "${cmd[@]}"
}

build_video() {
  local name="$1"
  shift
  local frames=("$@")
  local segs=()
  local i=0
  for f in "${frames[@]}"; do
    local seg="$TMP/${name}-seg-${i}.mp4"
    segment "$f" "$seg"
    segs+=("$seg")
    (( i++ )) || true
  done
  xfade_chain "${#segs[@]}" "$OUT/${name}.mp4" "${segs[@]}"
}

# Video A — MCP: pain → connect → approve → ask → relief → (loops to pain)
build_video "video-a-mcp-loop" \
  "$KF/intervu-video-a-mcp-keyframe-0-pain.png" \
  "$KF/intervu-video-a-mcp-keyframe-1.png" \
  "$KF/intervu-video-a-mcp-keyframe-2.png" \
  "$KF/intervu-video-a-mcp-keyframe-3-ask.png" \
  "$KF/intervu-video-a-mcp-keyframe-4-relief.png"

# Video B — OpenClaw: pain → install → auth → overnight → WhatsApp relief
build_video "video-b-openclaw-loop" \
  "$KF/intervu-video-b-openclaw-keyframe-0-pain.png" \
  "$KF/intervu-video-b-openclaw-keyframe-1.png" \
  "$KF/intervu-video-b-openclaw-keyframe-2-auth.png" \
  "$KF/intervu-video-b-openclaw-keyframe-3-overnight.png" \
  "$KF/intervu-video-b-openclaw-keyframe-2.png"

# Posters from beat 1 (pain)
cp "$KF/intervu-video-a-mcp-keyframe-0-pain.png" "$OUT/poster-a-mcp.png"
cp "$KF/intervu-video-b-openclaw-keyframe-0-pain.png" "$OUT/poster-b-openclaw.png"

echo "Done: $OUT/video-a-mcp-loop.mp4 (~14s)"
echo "Done: $OUT/video-b-openclaw-loop.mp4 (~14s)"

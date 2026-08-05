#!/usr/bin/env bash
# Silent explainer loop builder — UI keyframes + burned drawtext captions.
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
XFADE=0.4
# segment(input, output, hold_seconds)
# Captions burned into keyframe PNGs; drawtext skipped (ffmpeg build lacks libfreetype).
segment() {
  local input="$1"
  local output="$2"
  local hold="$3"
  local frames
  frames=$(printf '%.0f' "$(echo "$hold * $FPS" | bc -l)")

  local vf="scale=${W}:${H}:force_original_aspect_ratio=decrease,"
  vf+="pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x12151a,"
  vf+="zoompan=z='min(zoom+0.0003,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},"
  vf+="format=yuv420p"

  ffmpeg -y -hide_banner -loglevel error \
    -loop 1 -i "$input" \
    -vf "$vf" \
    -t "$hold" -c:v libx264 -pix_fmt yuv420p "$output"
}

# xfade_chain(output, seg0 seg1 ... | hold0 hold1 ...)
xfade_chain() {
  local out="$1"
  shift
  local -a segs=()
  local -a holds=()
  local arg
  for arg in "$@"; do
    if [[ "$arg" == *.mp4 ]]; then
      segs+=("$arg")
    else
      holds+=("$arg")
    fi
  done
  local n=${#segs[@]}

  if (( n == 1 )); then
    cp "${segs[0]}" "$out"
    return
  fi

  local filter=""
  local prev="0:v"
  local cumulative=0

  for (( i=1; i<n; i++ )); do
    cumulative=$(echo "$cumulative + ${holds[$((i-1))]} - $XFADE" | bc -l)
    local label="v${i}"
    if (( i == n-1 )); then
      label="outv"
    fi
    filter+="[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${cumulative}[${label}];"
    prev="$label"
  done
  filter="${filter%;}"

  local -a cmd=(ffmpeg -y -hide_banner -loglevel error)
  for f in "${segs[@]}"; do
    cmd+=(-i "$f")
  done
  cmd+=(-filter_complex "$filter" -map "[outv]" -c:v libx264 -pix_fmt yuv420p "$out")
  "${cmd[@]}"
}

build_video() {
  local name="$1"
  shift
  local -a specs=("$@")
  local -a segs=()
  local -a holds=()
  local i=0
  local spec
  for spec in "${specs[@]}"; do
    IFS='|' read -r file hold step caption <<< "$spec"
    local seg="$TMP/${name}-seg-${i}.mp4"
    segment "$KF/$file" "$seg" "$hold"
    segs+=("$seg")
    holds+=("$hold")
    (( i++ )) || true
  done

  local -a chain=()
  for (( j=0; j<${#segs[@]}; j++ )); do
    chain+=("${segs[$j]}")
    chain+=("${holds[$j]}")
  done
  xfade_chain "$OUT/${name}.mp4" "${chain[@]}"
}

# Video A — Claude MCP (6 beats, ~60% post-setup)
build_video "video-a-mcp-loop" \
  "intervu-video-a-mcp-keyframe-0-title.png|2.5|1|Connect Claude to the job market" \
  "intervu-video-a-mcp-keyframe-1-connect.png|2.0|2|Add connector" \
  "intervu-video-a-mcp-keyframe-2-approve.png|2.0|3|Approve once" \
  "intervu-video-a-mcp-keyframe-3-ask.png|4.0|4|Ask in chat" \
  "intervu-video-a-mcp-keyframe-4-results.png|4.0|5|Real jobs - save to tracker" \
  "intervu-video-a-mcp-keyframe-5-payoff.png|3.0|6|You stay in control"

# Video B — OpenClaw (6 beats, ~60% post-setup)
build_video "video-b-openclaw-loop" \
  "intervu-video-b-openclaw-keyframe-0-title.png|2.5|1|Overnight prep on your machine" \
  "intervu-video-b-openclaw-keyframe-1-install.png|2.0|2|One command install" \
  "intervu-video-b-openclaw-keyframe-2-approve.png|2.0|3|Approve in browser" \
  "intervu-video-b-openclaw-keyframe-3-overnight.png|3.5|4|Agent works overnight" \
  "intervu-video-b-openclaw-keyframe-4-digest.png|4.5|5|Wake up to drafts" \
  "intervu-video-b-openclaw-keyframe-5-payoff.png|2.5|6|You always click submit"

cp "$KF/intervu-video-a-mcp-keyframe-0-title.png" "$OUT/poster-a-mcp.png"
cp "$KF/intervu-video-b-openclaw-keyframe-0-title.png" "$OUT/poster-b-openclaw.png"

total_a=$(echo "2.5+2.0+2.0+4.0+4.0+3.0 - 5*$XFADE" | bc -l)
total_b=$(echo "2.5+2.0+2.0+3.5+4.5+2.5 - 5*$XFADE" | bc -l)
echo "Done: $OUT/video-a-mcp-loop.mp4 (~${total_a}s silent explainer)"
echo "Done: $OUT/video-b-openclaw-loop.mp4 (~${total_b}s silent explainer)"

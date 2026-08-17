#!/usr/bin/env bash
# Builds the assistant-not-ghostwriter film from source. Idempotent: same
# commit in, same bytes out — the page is scrubbed frame by frame rather than
# screen-recorded.
#
#   ./build.sh
#
# Requires: node + playwright (repo devDependency), ffmpeg with libx264.
#
# Adapted from docs/design/how-it-works-videos/studio/build.sh: this film is a
# linear 43s draft that ends on a close card, not a seamless loop, so the
# poster-frame extraction and the frame-0/last-frame psnr loop-seam assertion
# are dropped — that logic exists only because the how-it-works films loop
# back to their own title card. The ffmpeg encode invocation is unchanged.

set -euo pipefail

STUDIO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(dirname "$STUDIO")"
FPS=30
FILM="assistant-not-ghostwriter"

node "$STUDIO/extract-tokens.mjs"
node "$STUDIO/render.mjs" "$FILM"

frames="$STUDIO/.frames/$FILM"
[ -d "$frames" ] || { echo "no frames for $FILM" >&2; exit 1; }

ffmpeg -y -hide_banner -loglevel error \
  -framerate "$FPS" -i "$frames/f-%04d.png" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -movflags +faststart -r "$FPS" \
  "$OUT/video-$FILM.mp4"

size=$(du -h "$OUT/video-$FILM.mp4" | cut -f1)
echo "  video-$FILM.mp4 ($size)"

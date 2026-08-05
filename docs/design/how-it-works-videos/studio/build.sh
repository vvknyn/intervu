#!/usr/bin/env bash
# Builds both how-it-works films from source. Idempotent: same commit in, same
# bytes out — the pages are scrubbed frame by frame rather than screen-recorded.
#
#   ./studio/build.sh            both films
#   ./studio/build.sh a-mcp      one film
#
# Requires: node + playwright (repo devDependency), ffmpeg with libx264.

set -euo pipefail

STUDIO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(dirname "$STUDIO")"
FPS=30

# Poster frame. 2.5s in: the title has settled and the wordmark is centred, so
# the still reads as the film rather than as a mid-beat accident.
POSTER_FRAME=$((25 * FPS / 10))

films=("${@:-a-mcp b-openclaw}")
read -ra films <<<"${films[*]}"

node "$STUDIO/extract-tokens.mjs"

for film in "${films[@]}"; do
  node "$STUDIO/render.mjs" "$film"

  frames="$STUDIO/.frames/$film"
  [ -d "$frames" ] || { echo "no frames for $film" >&2; exit 1; }

  ffmpeg -y -hide_banner -loglevel error \
    -framerate "$FPS" -i "$frames/f-%04d.png" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
    -movflags +faststart -r "$FPS" \
    "$OUT/video-$film.mp4"

  cp "$frames/f-$(printf '%04d' "$POSTER_FRAME").png" "$OUT/poster-$film.png"

  # Frame 0 and the final frame are meant to be identical, which is what makes
  # the loop invisible. Assert it rather than trusting it — a content change
  # that leaves something on screen at the end would otherwise ship a visible
  # jump that nobody notices until it is on the site.
  # psnr reports at info level, so the loglevel has to allow it through — at
  # `error` the summary never prints and the check silently passes for the
  # wrong reason. `average:inf` means the two frames are bit-identical.
  last=$(printf '%04d' "$(( $(ls "$frames" | wc -l) - 1 ))")
  seam=$(ffmpeg -hide_banner -loglevel info \
    -i "$frames/f-0000.png" -i "$frames/f-$last.png" \
    -filter_complex psnr -f null - 2>&1 | grep -o 'average:[^ ]*' | tail -1)
  if [ "$seam" != "average:inf" ]; then
    echo "  WARNING: $film first and last frame differ ($seam) — the loop will jump" >&2
  fi

  size=$(du -h "$OUT/video-$film.mp4" | cut -f1)
  echo "  video-$film.mp4 ($size) + poster-$film.png"
done

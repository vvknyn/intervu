# GROUP F — special files, skeletons, OG images, /mock fixtures (Fable spec, Sep 3 ~01:05 EDT)
Rulebook v2 clauses 1–9. Build only with GROUP-B primitives.

## Scope (from impl/ROUTES.md "special" rows)
- `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx` (+ any nested error/not-found files listed in ROUTES.md)
- the 5 `loading.tsx` skeletons listed in ROUTES.md
- OG / icon image routes (`opengraph-image.tsx`, `icon.tsx`, `apple-icon.tsx` if present)
- `/mock/*` (7 fixture pages): they inherit the primitives; no bespoke styling added; only remove banned classes that the Group A sweep could not map.

## Rules
- Error / not-found pages: centered column max-w 480, wordmark exempt; title 20/28 600 ("Page not found", "Something went wrong"); body 14/20 secondary; ONE filled Klein h-8 ("Go to jobs") + ghost "Try again" / "Report"; no illustration, no emoji, no coloured icon tile; status code as 12/16 secondary text ("404") not a display number.
- global-error.tsx renders without the app layout → it must import the same tokens (globals.css) and use inline classes only from the primitive set; still 0 radius / no shadow.
- loading.tsx skeletons: `bg-muted` pulse, 0 radius, blocks sized to the real anatomy they replace (header row 28px, list row 72px with 36px tile, detail title 28px + 20px meta lines); never a spinner icon; no shimmer gradients.
- OG images (ImageResponse): palette ONLY page #FFF / ink #0A0A0A / Klein #002FA7 / secondary #525252; Source Sans (load the font file the route already uses, or system sans fallback); wordmark 700 allowed; title ≤ 2 lines 600; sentence case; no gradients, no radius, no shadow. Icon routes: bracket-gate mark on white, 0 radius.
- /mock/*: run the probe; fix ONLY via primitive/class swaps; do not restyle fixtures by hand.

## Deletions allowed
Unused imports and dead class strings only.

## Verify (≤30 lines back)
1. test:design + tsc clean.
2. route-probe on /not-found (`/this-route-does-not-exist`), each /mock route, and any loading state you can capture (throttle: `--slow` flag if route-probe supports it, else a screenshot mid-navigation) → before→after table.
3. Render each OG route to PNG (`curl -o $SP/groupF/og-<name>.png http://localhost:3000/<route>`) and list the files; Fable views them.

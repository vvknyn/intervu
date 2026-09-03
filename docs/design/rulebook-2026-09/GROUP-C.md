# GROUP C — /jobs SERP + /jobs/[slug] detail (Fable spec, Sep 3 ~01:05 EDT)
SOURCE OF TRUTH = the approved round-7 canvas: `canvas2/src/page.html` (full SERP, 65 KB — read by region, do not paste), `canvas2/src/filters.html` (band), `canvas2/src/detail.html` (detail column), `canvas2/src/anatomy.html` (row heights / measured numbers), `canvas2/src/base.css` (exact px values). File:line map of today's code = `impl/JOBS-PAGE-MAP.md`. Machine oracle = `tests/e2e/jobs-rulebook.spec.ts` (regions header/band/list/detail marked with `data-region`; run `npm run test:jobpage`). GROUP-B primitives are already in place — reuse them; the header itself is Group B's (done).

## Band (`data-region="band"`, 40px, layer bg, hairline bottom) — canvas filters.html
- Chips h-8 px-3 14/20, hairline, selected = Klein border + Klein text on page bg; NO icons inside chips except the 16px chevron on menu chips; sentence case labels ("Posted", "Remote", "Level", "Pay", "Company", "Sponsorship" — copy from canvas).
- Red-60 text "Clear" (ghost, red #DA1E28) rendered AFTER the last chip (round 7 ruling; Klein-ghost alternative = ruling owed, do not implement).
- Right side: "Save search" ghost word (Klein text, no icon) · "Sort: Relevance" 14/20 ink + 16px chevron (text + chevron, NOT a segmented control). Zero filled buttons in the band.
- Below `lg` the same band renders inline in page.tsx (portal split per JOBS-PAGE-MAP §Region 2) — both paths must match.

## List (`data-region="list"`) — canvas page.html rows + anatomy.html
- Count line above rows: "1,204 product manager roles · 30 days" 14/20 secondary, py-8.
- Row anatomy (comfortable): py-16; 36px CompanyInitialTile (exempt glyph) left; separators INSET to the title x (start after tile + 12px gap); title 16/22 600 ink; company · location 14/20 secondary (location pin allowed ONLY as the HIG prefix before the place, never icon+word for the same fact); facts line 14/20 secondary joined by " · " (pay, work mode, posted); status = WORDS not badges: "Live" in --live, "Relisted"/"New" 12/16 600 in secondary, "Verified" secondary; no chips, no pills, no fact icons.
- Selected row = layer bg + 3px Klein left bar; hover = layer bg; focus = 2px Klein outline inset.
- Bookmark on the row: 40px icon-only ghost control, 20px icon (allowed inside 40px), Klein when saved.
- Pagination / load more: ghost "Show more" h-8 or hairline page links; no filled.

## Detail (`data-region="detail"`, right column desktop / full page /jobs/[slug] mobile) — canvas detail.html
- Title 20/28 600 ink; company line 16/22 ink with 36px tile; meta 14/20 secondary " · "-joined (location, work mode, level, pay, posted, first seen) — NO chips with icons (today's Onsite/Full time/Senior/USD/Posted/First seen chips become one text line + a second line if it wraps); flags/emoji removed.
- Actions row: ONE filled Klein "Sign in to apply" h-10 (signed-in: "Apply") + 40px icon-only bookmark (20px icon, ghost) + overflow/Report as ghost; sentence case (not "SIGN IN TO APPLY").
- "Posting check" = disclosure (line accordion primitive), trigger 14/20 600 ink + 16px chevron; verdict as WORD "Actively posted" in --live (not a green pill); rows 14/20: label sentence case ("Freshness", "Reposts", "Description", "Pay") 600 + value 400 secondary; check marks 16px in --live, dot "not tracked" = secondary text, no boxed check rows; summary "3/3 favorable · 1 not tracked" 14/20 secondary; "checked 1d ago" 12/16 secondary.
- Description: body 16/22 ink, measure 640, headings 16/22 600, lists plain; "Source" / apply-origin as 14/20 secondary text with Klein link.
- Similar roles / company block: rows per list anatomy; company header 16/22 600 + "Follow" ghost.
- Mobile (/jobs/[slug] 390): same order; sticky bottom action bar h-12 opaque page bg + hairline top holding the ONE filled "Sign in to apply" h-10 + 40px bookmark; MobileTabBar per GROUP-B.
- Local-only "Report listing isn't available right now" bubbles (missing API key) are already `data-rulebook-exempt` when unavailable — leave that.

## Deletions allowed
Unused imports, dead chip/badge class strings, the redundant fact icons, emoji/flag literals. Nothing else (no route/component/test/asset deletions; page.tsx is 5,700 lines — edit in place, do not split it in this group).

## Verify (≤40 lines back)
1. `npm run test:jobpage` → paste the per-region table (type/depth/spacing/filled) — target 0/0/0 and filled header 0 · band 0 · list 0 · detail 1 (update the spec's EXPECTED_FILLED_BUTTONS.header to 0 if Group B has not already).
2. route-probe on `/jobs`, `/jobs?q=product+manager`, `/jobs/<sample slug>` desktop + mobile → before→after table (before: /jobs 390/161, /jobs?q 396/172-ish, /jobs/[slug] see impl/before/ROUTES.md).
3. Screenshots in $SP/groupC/shots/ledger/ + one with the Sort menu open and one with a selected row.

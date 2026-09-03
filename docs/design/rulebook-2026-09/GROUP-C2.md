# GROUP C2 — /jobs list + detail ANATOMY pass (Fable spec, Sep 3 ~06:45 EDT)
Pass 1 (commit "Group C pass 1") made the regions MEASURE clean (type/depth/spacing/filled) but left the OLD ANATOMY in place. The oracle cannot see anatomy, which is why it passed. Your job: make the pixels match the canvas and make the oracle able to catch these classes.

SOURCE OF TRUTH = `canvas2/src/detail.html` (detail column), `canvas2/src/page.html` (rows; read by region), `canvas2/src/anatomy.html`; rules in `canvas2/RULEBOOK.md`; today's file:line map `impl/JOBS-PAGE-MAP.md`. Oracle = `tests/e2e/jobs-rulebook.spec.ts` (`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/jobs-rulebook.spec.ts --reporter=line`). Dev server :3000 is already running — never restart it. Route probe: `cd $SP && NODE_PATH=/Users/vivek/Antigravity/Code/interview-os/node_modules node route-probe.cjs routes.json <out> jobs --base=http://localhost:3000`.

## STEP 0 — teach the oracle first (prove it fails, then fix)
Add two assertions per region for `list` and `detail` in jobs-rulebook.spec.ts, then RUN it and paste the failing counts before you change any UI:
1. **No cards**: elements inside the region with a 1px border on ALL FOUR sides and width > 48px → expected 0 (36px company tiles stay under the size floor; `data-rulebook-exempt` elements skipped, same as today's probe).
2. **No chips**: elements inside the region that are inline/inline-flex, have any border, height ≤ 32px and font-size ≤ 14px → expected 0. (Band chips live in `band`, not in these regions — they are allowed there.)
Both must FAIL on the current tree (that is the proof they detect the class) and PASS when you are done.

## Detail — what I saw (screenshots impl/pre-g/shots/ledger/jobs-slug-desktop.png + groupC jobs-desktop.png) → what the canvas says
Files: `src/components/jobs/JobDetail.tsx`, `PublicJobDetail.tsx`, `JobDetailDocument.tsx`, `src/app/jobs/[slug]/page.tsx`, detail region of `src/app/jobs/page.tsx`.
a. Meta row = six hairline boxes each with a 16px icon (Onsite · Full Time · Senior · USD 160k–190k/yr · Posted 1d ago · First seen 1d ago) → ONE 14/20 secondary text line joined by " · ", no icons, no boxes; it wraps to a second line naturally. Order: location · work mode · level · pay · posted · first seen.
b. Flag emoji before the location → delete. Keep at most one 16px pin as the HIG prefix before the place name (never pin + word "Location").
c. "Spark" / keyword chips (Klein-outlined boxes; SERP shows "Keywords from the posting" + a boxed "spark") → label "Keywords from the posting" 14/20 600 ink + one 14/20 secondary line joined by " · ". No boxes.
d. Section cards (hairline box around header block, "About this role", "Posting check", company block, AI block; SERP company block sits on a bg-muted panel) → NO boxes and NO panels: sections stack on page bg separated by a hairline `border-t border-border` and py-6 (24px), body copy 16/22 ink at measure 640 (`max-w-[640px]` is already an allowed arbitrary value? — no: use the existing measure utility if one exists, else `max-w-2xl` is off-scale; check `impl/JOBS-PAGE-MAP.md` §Detail for the measure class the canvas mapped, and use it).
e. Posting check: heading "Posting check" (sentence case; SERP currently "posting check" + a segmented green progress bar → delete the bar). Row labels sentence case — "Freshness", "Reposts", "Description", "Pay" — 14/20 600 ink, value 14/20 400 secondary; check marks 16px in `text-live`; "not tracked" rows = secondary text, no glyph; summary "3/3 favorable · 1 not tracked" 14/20 secondary; "checked 1d ago" 12/16 secondary; the SERP's underlined "every signal automated · nothing inferred" → 12/16 secondary, no underline. Verdict "Actively posted" stays a WORD in `text-live`.
f. Actions: exactly ONE filled Klein per column. `/jobs/[slug]` right rail: "Sign in to apply" filled h-10 (keep) + "Save" is currently an OUTLINE icon+word button → 40px icon-only ghost bookmark (20px icon), no border. "Open in your AI →" is a SECOND filled Klein → ghost Klein text link "Open in your AI" (no fill, no border). SERP detail top-right: the flag (report) and copy controls are hairline-boxed 40px squares → ghost 40px icon-only (no border). The local-only "Report listing isn't available right now." bubble stays exempt.
g. Company block ("Metropolis · hiring truth", 82 / 71/8): keep the content; render on page bg with a hairline top; company name 16/22 600; numbers 20/28 600 ink; captions 14/20 secondary; links = Klein text, no underline decoration unless it is already the site link style.

## List (SERP rows, list region of `src/app/jobs/page.tsx`)
h. Rows are bordered CARDS with ~12px gaps → rows separated ONLY by a hairline `border-b border-border` inset to the title x (starts after the 36px tile + 12px gap), no top/side borders, no gaps, py-4 (16px). Selected = `bg-muted` + 3px Klein left bar (already there); hover `bg-muted`; focus-visible 2px Klein inset outline.
i. Count line ("122,623 roles from the last 30 days · updated 1d ago (more roles beyond 30 days — show all)") sits in a bg-muted box → plain 14/20 secondary text, py-2, "show all" as Klein text link.
j. Loading skeleton rows are bordered boxes → same row anatomy as h (hairline-separated, no boxes); the bars already use `.skeleton-bar`.
k. "+1 location" boxed chip → plain "· +1 location" appended to the meta line.
l. Row bookmark: 40px icon-only ghost control, 20px icon (RowBookmarkButton.tsx) — confirm hit area is 40×40 and the icon is 20 (a bare 16px glyph with no control is not it).
m. Band: the "Filters" chip carries a funnel icon → chips carry NO icon except the 16px chevron on menu chips; render "Filters" as text (this also removes the last 12px svg). The "?" ContextHelp at the band's right end is a hairline-boxed square → ghost, no border.

## Do not
- Do not touch `src/components/ui/*` primitives, `globals.css`, `scripts/design/*`, `tests/unit/*`. Do not restart the dev server. Do not commit. Do not create files at the repo root.
- Do not change copy/semantics (what a row says); only its anatomy. If a rule conflicts with data you can't render (e.g. no "Verified" flag exists), leave it out and list it.
- Icons: 16px default (IconDefaultsProvider), 20 only inside a 40px control, 24 display; `node scripts/design/icon-sizes.cjs` must stay at 0 offenders.

## Return (≤40 lines)
1. Oracle table BEFORE your UI edits (the two new assertions failing, with counts) and AFTER (20+ tests, all pass; per-region type/depth/spacing/filled/cards/chips).
2. Route-probe before→after for /jobs, /jobs?q=product+manager, /jobs/[slug] desktop+mobile (all must be 0/0). Probe AFTER results render (the pre-G run caught the skeleton — wait for a row).
3. Screenshots in `$SP/groupC2/shots/ledger/`: jobs-desktop, jobs-mobile, jobs-slug-desktop, jobs-slug-mobile, selected-row, sort-menu-open. Read each PNG yourself before claiming.
4. `npx tsc --noEmit` exit code; `npm run test:design` pass/fail counts; `node scripts/design/icon-sizes.cjs` count.
5. Files changed; anything left unfixed with the reason.

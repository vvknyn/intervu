# Velai compound design language — rulebook v1 (2026-09-02, Vivek ruling: hybrid Carbon + HIG + ours)

Composition rule: ONE parent wins per axis. Anything not listed here is EXCLUDED by default.
Where this file disagrees with BRIEF.md, this file wins. Levers, boards, copy and file layout from BRIEF.md stay.

## Axis table (source → value)

| Axis | Parent | Value used in the mockup |
|---|---|---|
| Spacing scale | Carbon | ONLY 2, 4, 8, 12, 16, 24, 32, 40, 48 px. No other padding/margin/gap values anywhere. |
| Grid | Carbon | 16px gutters; list column w520 → content x = 24, 32 (tight edges), 48 (loose). Page content starts at x=32. |
| Header height | Carbon UI shell | 48px, white, 1px bottom hairline, no fill, no shadow, no blur. |
| Control heights | Carbon | sm 32 (filter row, header search + button), md 40 (detail actions). Never 36. |
| Field style | Carbon field-01 | bg #F4F4F4, 1px bottom border #8D8D8D at rest, 0 radius, placeholder #8D8D8D; focus = 2px outline #002FA7 (Klein), no glow. |
| Buttons | Carbon (shape) + ours (color) | primary = filled #002FA7, white 14/400 label, sentence case, padding 0 16, 0 radius, one per region; tertiary = 1px #002FA7 outline, blue text; ghost = blue text only. NO uppercase, NO letter-spacing, NO gray-filled secondary. |
| Type ramp | Carbon productive scale | 12/16, 14/20, 16/22, 20/28 (size/line-height). Weights 400 and 600 only. Tabular nums everywhere numbers appear. |
| Type roles | HIG | Title = detail title 20/600. Headline = row title 16/600. Body = 14/400 ink. Subheadline = 14/400 secondary. Footnote = 12/400 secondary. Caption/section label = 12/600 ink, sentence case. Exactly these six. |
| Text colors | Carbon roles, our values | text-primary #0A0A0A · text-secondary #525252 · interactive #002FA7. Placeholder #8D8D8D (placeholders only). Status words: green #15803D, amber #B45309. That is the whole palette for text. |
| Surfaces | Carbon layers | page #FFFFFF · layer/well #F4F4F4 · hairline #E0E0E0. Depth = tint step or hairline. Shadows only on floating menus (none on this page). |
| Selected row | Carbon side-nav selected | bg #F4F4F4 + 3px #002FA7 left bar. No tint-blue background. |
| Corners | ours (= Carbon) | 0px everywhere, including logos (square 36px, 1px hairline inset). |
| List rows | HIG list + Carbon density | hairline separators INSET to the title x (start after logo + 12px gap, not full width). Comfortable: 16px top/bottom padding. Compact: 8px. Measure resulting row heights and put the numbers on the Anatomy board. |
| Status/facts | ours | words, not badges: "Relisted" amber 14/400, "New" green 14/400 after the title; meta line = plain text with middots, no icons; right column "5d ago" 12/400 secondary + "Active" with 6px green dot. |
| Tags/pills | EXCLUDED (Carbon tags are pills) | skills = plain 14/400 secondary text separated by middots. No pill, no bordered chip. |
| Active filters | Carbon filter pattern | filter row = ghost text buttons 14/400 with 16px chevron SVG; the active one reads "Posted: Past month" 14/600 ink on #F4F4F4 (h32, padding 0 12). "near Canada" gets a 16px close SVG, no pill shape (square). |
| Disclosure | HIG | "Posting check · 2/3 favorable · 1 not tracked" is a disclosure row with a 16px chevron; the 4 signal lines below are its expanded content. |
| Icons | HIG symbols discipline, Lucide-style strokes | 16px, 1.5px stroke, currentColor, baseline-aligned. Allowed on this page: search, chevron, close, overflow (three dots as SVG circles). Nowhere else on the quiet render. Markup for the comparison levers (icons-on, rows-cards, chrome-current, labels-icons, labels-emoji) may carry other glyphs; it is display:none by default and exempt. |
| Whitespace | HIG proximity | 24px between groups inside the detail pane, 8px within a group, 32px between the header/filter band and the list. |
| Motion | HIG | none in a static board. |
| Voice/copy | ours | verbatim from ../prod/velai-text.txt. Sentence case everywhere (also "Sign in to apply", "Save search", "Get job alerts", "Show all 13,491"). |
| Typeface | ours | Source Sans 3 body; Libre Franklin 700 wordmark. IBM Plex and SF are NOT used. |

## Explicit exclusions (write these on the Sources board)
> Surfaces and fills (translucency, blur, glass bars) are governed by `docs/design/DESIGN-LANGUAGE.md` (Calm pass R4: glass on chrome bars only). Where the list below disagrees with it, DESIGN-LANGUAGE.md wins.

HIG materials/translucency/blur · HIG rounded corners · Carbon blue-60 and IBM Plex · Carbon pill tags · Carbon gray-filled secondary buttons · uppercase tracked labels · NEW/Relisted badge pills · icon-per-fact meta rows · glass header · card boxes with shadows for list items · more than one filled button per region · font sizes outside 12/14/16/20 · text colors outside the five above.

## Boards
- Main, Anatomy, Detail, Today: as BRIEF.md, re-rendered under this rulebook. Keep the four levers; the `chrome: current` lever still shows today's treatment for comparison.
- NEW `Sources.dc.html` 1000×480 (was 640 in v1.0; shortened in round 2), static, white: four columns headed "From Carbon", "From HIG", "Ours", "Excluded"; each column lists the axis rows above as 14/400 text, 8px apart, column heads 12/600. No icons, no boxes; hairlines between columns. Add it to canvas.json at (0, 1580, 1000, 480) and move the "principles" annotation to (1120, 1960, w320).
- Annotation text becomes: "Compound language: Carbon's grid, layers, controls and type scale · HIG's type roles, inset lists, disclosure and whitespace · our color, corners, typeface and voice. One parent per axis; everything else excluded."

## Acceptance (the coder checks these on its own renders before returning)
1. Computed font sizes on Main ∈ {12, 14, 16, 20}. Computed text colors ∈ {#0A0A0A, #525252, #002FA7, #8D8D8D, #15803D, #B45309} (+ white on the primary button).
2. Zero box-shadow, zero backdrop-filter, zero border-radius > 0 on Main (quiet chrome).
3. Every padding/margin/gap value ∈ the Carbon scale above.
4. One filled button in the header region, one in the detail region.
5. Row heights measured (comfortable, compact) and written on the Anatomy board.
6. (added 21:32 after the round-4 leak) Lever-only markup (label glyphs, icons-on meta icons, cards chrome) is hidden on EVERY board that embeds the row markup — Main quiet, Anatomy, Detail — with no dependency on an ancestor class. Count visible lever-only elements per board = 0.
Report the six results as numbers in the return.

## v1.1 addition — 2026-09-02 20:52, Vivek: "where possible lets use icons or emojis to convey information instead of text...that makes it cleaner"
Status: DRAFT. Fable verdict PARTIAL. The literal version is built as a lever on Main so it can be seen before it becomes a rule. Vivek rules after looking.

| Axis | Parent | Value |
|---|---|---|
| Icon replaces label | HIG symbols + Carbon icon-only buttons | Allowed ONLY where the symbol is universally learned and the meaning survives without the word: search, close, chevron/disclosure, overflow, bookmark (Save, beside the filled Sign in to apply — the neighbour carries the meaning; Vivek 22:00, reversing his 20:56 Save-search example), external link. Every icon-only control carries aria-label + title with the word it replaced. Ghost icon buttons 32px in header/filter band, 40px in detail. |
| Icon as prefix, label kept | HIG | Location pin before a place name only. Never icon AND word for the same fact anywhere else (today's meta row does this; it measured 50 icons in the first screen). |
| Enumerated facts | ours | Work mode, employment type, seniority, status, Relisted/New stay WORDS. The value set is private to the product (Hybrid vs Remote vs Onsite, Mid vs Senior, Relisted); a glyph per value is a vocabulary the visitor must learn on first visit, a word is read at zero cost. Product rule "only facts, no inference": the word is the fact, the glyph is a summary of it. |
| Emoji | EXCLUDED | Glyph art differs per OS and browser (Apple, Google, Microsoft, Samsung draw different pictures); colors are baked into the glyph and fall outside the five-color palette; no stroke weight or optical-size control at 12–16px; screen readers speak the Unicode name ("house with garden"); reads as chat, not as a tool. |

### Lever spec: `labels` (round 4) — values text (default) | icons | emoji
Fifth hole `{{labelsClass}}` on the Main root, classes `labels-icons` / `labels-emoji`, wired into the lever toolbar like the other four. Faithful to the request: wherever a word CAN be replaced, it is. Same swaps in the list rows AND the detail pane (Detail.dc.html shares page markup).
Slots (word removed → glyph, glyph carries `role="img" aria-label="<word>" title="<word>"`):
- Work mode: Onsite → building · Hybrid → house · Remote → laptop
- Employment type: Full time → clock · Part time → half-clock · Contract → document
- Seniority: Junior/Mid/Senior → 1/2/3 filled bars
- "5d ago" → clock glyph + "5d" (word "ago" removed)
- "● Active" → 6px green dot only (word removed)
- "Relisted" → circular-arrows glyph, amber · "New" → 4-point star, green
- Detail "Save" ghost text button → bookmark icon-only ghost 40px
- Detail "Posted 5d ago · First seen 84d ago" → clock 5d · eye 84d
- Place name keeps its text and gets a pin prefix
- Company name, pay, title: text (no glyph can carry them; USD vs CAD is information)
`labels-icons`: 16px 1.5px-stroke inline SVG, currentColor #525252 (amber/green for Relisted/New).
`labels-emoji`: same slots with 🏢 🏠 💻 · 🕒 · 📶 (one glyph for all three levels; emoji has no 1/2/3 bars, keep the word beside it) · 🕒 5d · 🟢 · 🔁 (renders blue on Apple; cannot be tinted amber) · ✨ · 🔖 · 📍. font-size 14px, no color override (emoji ignore it).
Measure both with verify-weight.cjs (icons in view, text characters in the list, glyph count) and put the three numbers on the Anatomy board under a new "Labels" line.

### Round 4 addendum (20:59)
- Default render: Save search = ghost text; detail Save = bookmark icon-only ghost 40px (Vivek, canvas comment 22:00).
- Sort stays text (value is information). "Get job alerts"/"Sign in" stay text by default; bell icon-only only in the labels-icons state.
- Sources board: HIG column gains "Icon-only controls: search, close, chevron, overflow, bookmark (Save, beside Sign in to apply)"; Excluded gains "Emoji glyphs" and "Icon per enumerated fact".

### Review fixes folded into round 4
- Copy drift: page.html result line must read "5,306 roles from the last 30 days · updated 19h ago" (verbatim ../prod/velai-text.txt:69).

## Rulings 2026-09-02 23:56–23:57 (Vivek, terminal) — round 6
- Filters: "just keep the original design for the filters...that bubble thing can be reserved for later" → Main keeps the filter band of rounds 1–4 (active state + chip, Save search, Sort). "Clear" (a round-5 addition — not on the live page, not in BRIEF.md) removed from Main. Filters board PARKED (retitled), not deleted; FILTERS-BRIEF.md kept for later.
- Logo: "revert back to the previous logo of 2 square brackets and the green dot" → axis **Logo | ours | bracket-gate mark** (intervu repo `src/components/brand/BrandMark.tsx` at 572de99^, in use Aug 13–27): viewBox 0 0 64 64; brackets `M22 16H10v32h12v-6h-6V22h6z` + `M42 16h12v32H42v-6h6V22h-6z` fill currentColor; dot cx32 cy32 r7 fill `--live` #0E9F4E (dark #2FBF71). 24px in the 48px header. Note: the dot's green is the brand --live token, not the status-word #15803D — one green to reconcile at implementation (flag to Vivek).
- Implementation: "start implementation of the changes" → GO. Target repo vvknyn/intervu (serves velai.app); worktree /Users/vivek/Antigravity/Code/intervu-2026-09-02-cleaner-jobs, branch feat/2026-09-02/cleaner-jobs off origin/main a662014.

### Round 7 (2026-09-02 23:56, Vivek canvas thread df80e133): "Make the clear button in red and maybe move it next to 'near canada' because it's part of the filter control"
Fable verdict PARTIAL. Placement ADOPTED: Clear sits immediately after the last active chip (HIG proximity — it acts on that group; Carbon's clear-filters control also pairs with the active filters). Red BUILT AS ASKED and flagged: both parents reserve red for destructive/error (Carbon $text-error red-60 #DA1E28, HIG systemRed); Clear is reversible; red out-shouts the one filled button. Recommendation on record: ghost Klein like the other band controls. Palette: Carbon red-60 #DA1E28 admitted for this one control only (text-color axis parent = Carbon). Supersedes the round-6 line "Clear removed from Main".

## v2 — SITE-WIDE scope (Vivek, 2026-09-03 00:41 EDT: "use this design language everywhere... the resume, the user profile, the blog posts and ALL pages... very thorough... enumerate all the pages")
Scope: every route under src/app (36 pages, 6 layouts, error/not-found/loading states, /mock fixtures included), verified page by page in impl/ROUTES.md. The v1 rules stand; these clauses extend them to non-SERP surfaces. Fable decisions, reversible, recorded here because Vivek is AFK.

1. Type scale (productive, all product UI): 12/16 · 14/20 · 16/22 · 20/28, weights 400/600 (Carbon). ADDED expressive scale for marketing/blog/story headings ONLY (Carbon expressive heading-04/05/06): 28/36 · 32/40 · 42/50, weight 600. Nothing above 42px. No arbitrary `text-[Npx]` sizes anywhere: 10–13 → 12, 14–15 → 14, 16–18 → 16, 19–24 → 20, 25–30 → 28, 31–36 → 32, 37+ → 42.
2. Weights: 700 is retired everywhere except the wordmark (`font-bold` resolves to 600 at the theme level). 500 is retired: titles/labels → 600, everything else → 400.
3. Case: sentence case everywhere; `uppercase` and `tracking-*` classes removed site-wide (letter-spacing normal), except the wordmark. All-caps string literals in copy are rewritten to sentence case.
4. Depth: shadow tokens resolve to none, blur tokens to 0, radius tokens to 0 at the theme level; translucent backgrounds (`bg-x/NN`) become opaque layer colours; `.glass-*` utilities are removed from use (flat page/layer/hairline).
5. Colour: the raw Tailwind palette is REMAPPED at the theme level onto the rulebook palette (gray/slate/zinc/neutral/stone 50–200 → #F4F4F4/#E0E0E0, 300–500 → #8D8D8D/#525252, 600–950 → #0A0A0A; blue/indigo/sky → #002FA7; green/emerald/teal → --live; amber/yellow/orange → #B45309; red/rose → #DA1E28), so an un-swept `text-gray-500` conforms by construction. Semantic tokens stay the preferred spelling; new code uses tokens only.
6. Icons (site-wide): 16px, 1.5px stroke, currentColor; 20px only inside 40px controls; the 24px mark. No icon-per-fact decoration, no emoji glyphs in product UI, no coloured icon tiles. Icons that carry meaning keep a text label or aria-label.
7. Controls: primary filled Klein (one per region), ghost = Klein text, tertiary = 1px Klein outline + Klein text (the button ladder in the axis table above; no grey-filled secondary — `secondary`/`quiet` variants render as tertiary); inputs = field-01 (layer bg, 1px bottom hairline, 0 radius, h32/h40); focus = 2px Klein outline. Badges become words (Relisted/New/Active/Verified as text in the status colour), never pills.
8. Content pages (blog/stories/legal/about): measure 640px, body 16/22 ink, secondary 14/20, headings from the expressive scale, 24px between blocks, 8px within; links Klein underlined on hover; no `prose` defaults that re-introduce grey/rounded/shadow — the prose theme is bound to the tokens.
9. Verification per route: the probe runs on every route in impl/ROUTES.md at 1440×900 and 390×844 with a screenshot each; routes that need a signed-in session (/settings server-gated; /yours, /account, /resume, /admin signed-in states) are verified locally by tsc + the banned-class lint + probe on their signed-out state, and by pixels on prod with Vivek's session after deploy — stated in the ledger, never claimed as pixel-verified before that.

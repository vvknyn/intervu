# GROUP D — content pages + D2 company/watch (Fable spec, Sep 3 ~01:05 EDT; from before-shots in impl/before/shots/ledger/*)
Rulebook: canvas2/RULEBOOK.md (v1 + rounds 4–7 + v2 clauses 1–9). Primitives from GROUP-B are the ONLY building blocks. Fix the class first (shared content components), then per-page leftovers.

## Routes (D) — src/app/<route>/page.tsx + their components
/about · /research/ghost-jobs · /trends · /connect · /connect/help · /contact · /openclaw · /privacy · /terms  (/ and /companies/hiring redirect → nothing to style)
## Routes (D2)
/co/[slug] · /companies/[slug] (same components) · /watch/anywhere · /watch/[id] (signed-in; code-level)

## D-anatomy (applies to every content page; measured from before shots)
| Element | Before (measured) | Target |
|---|---|---|
| Kicker / eyebrow | uppercase, tracked, Klein, coloured square or pill with icon (`/connect`), "· " separators | 12/16 600 secondary #525252, sentence case, no tracking, no square/dot/pill/icon/border. Multi-part kickers keep " · " |
| H1 | 44–48px Libre Franklin 700 | 42/50 600 Source Sans (marketing: /about /research /connect /openclaw); 32/40 600 (utility: /privacy /terms /contact /connect/help /trends). Max measure 640px on text pages; hero text may be centered but still ≤640 |
| Dek / lede | italic 18–20px grey | 20/28 400 secondary (marketing) or 16/22 400 secondary (article/utility). Never italic |
| Section heading | uppercase 12–13px tracked labels + 24–28px 700 heads | 20/28 600 ink; sub-labels 12/16 600 secondary sentence case. 24px between blocks, 8px within (clause 8) |
| Body | 16–17px | 16/22 ink; captions/help 14/20 secondary |
| Tables | uppercase header cells, zebra/tints | header 12/16 600 secondary sentence case + hairline; cells 14/20; hairline row separators; numeric right-aligned; no zebra, no tints |
| Links | Klein + trailing "→" | Klein text, underline on hover, NO trailing arrow glyphs (drop the "→" literals) |
| Cards / steps | bordered cards, boxed step-number tiles, shadows | flat panel: page bg, 1px hairline, p-16 (compact) or p-24; step numbers = plain "1" 12/16 600 secondary text, no tile |
| Code / command blocks | mono in bordered dark-outline box, uppercase label | layer bg #F4F4F4, mono 14/20 ink, 0 radius, no border; label above = 12/16 600 secondary sentence case ("MCP endpoint", "Mac terminal command"); Copy = ghost h-8 word "Copy" |
| Status words | green/amber pill badges ("available today", "waitlist", "Self-Hosted") | words: "Available today" 12/16 600 in --live; "Waitlist" 12/16 600 warn #B45309; "Self-hosted" 12/16 600 secondary. No pill, no bg, no border |
| Tinted blocks | light-blue card bg + blue border (`/connect` macOS card), navy fills | layer bg #F4F4F4 or page + hairline; never a coloured border |
| Filled buttons | several per page, navy "Notify me", 40px uppercase | ONE filled Klein h-8 per region (a card is a region); others → ghost (Klein text) or outline. "Notify me" → filled Klein h-8 (its card's one). "Open Claude" → ghost with 16px external icon after the word |
| Accordions | bordered rows with leading icons + chevrons | GROUP-B line accordion: hairline separators, h-10 trigger 16/22 400 ink, 16px chevron right, NO leading icons |
| Client picker (Claude/ChatGPT/Gemini/Cursor) | bordered chip tabs | GROUP-B line tabs (h-10, 2px Klein active bottom border) |
| Icons | decorative per-section icons, coloured tiles | removed unless they carry meaning; 16px currentColor; no tiles |
| Emoji | flags / glyphs in copy | removed (clause 6) |

## Per-page notes (beyond anatomy)
- **/about**: kicker "About velai"; H1 42/50; lede non-italic 20/28; sections 20/28 600; any team/values grids → 2-col flat panels; measure 640 for prose.
- **/research/ghost-jobs** (article, heaviest content page: 93/44 before): kicker "From our research · Corpus snapshot" 12/16 600 secondary; H1 42/50; dek 16/22 secondary; stats tables per table rule; pull quotes = 20/28 400 ink with 3px Klein left rule, no italics; figure captions 14/20 secondary; footnotes 12/16 secondary.
- **/trends** (dashboard, 284/67 before): KPI cards flat hairline p-16; label 12/16 600 secondary sentence case (NOT uppercase); value 20/28 600 ink (productive scale — clause 1 keeps expressive for marketing/blog only); delta 14/20 in --live / warn as words ("+12% vs last month"); REMOVE icon tiles top-right of cards. Charts: series palette Klein #002FA7 → #8D8D8D → #0A0A0A; caution #B45309; positive --live; bars 0 radius; grid lines hairline #E0E0E0; axis labels 12/16 secondary; legend = 8×8 square swatch + 12/16 label (data-viz key, not a badge). No navy #1F2A44-style fills — remap to the palette.
- **/connect** (169/105 before): pill kicker → text kicker "Model context protocol (MCP) and local agents"; H1 42/50 (measure 640, left-aligned as today); two cards flat hairline p-24; card titles 16/22 600 + 14/20 secondary subtitle; step rows: number 12/16 600 secondary, title 14/20 600 ink, body 14/20 secondary; endpoint block per code rule; card 1 filled = "Sign in" h-8; macOS block: layer bg, no blue border, "Available today" word; Windows/Linux block: "Waitlist" word, email field-01 h-8 + filled "Notify me" h-8; accordions per rule; "How MCP works" / "Watch the demo" → ghost links without arrows.
- **/connect/help**: utility (32/40 H1), FAQ → line accordion, code blocks per rule.
- **/contact**: 32/40 H1; form = GROUP-B field-01 inputs + textarea, labels 12/16 secondary above, one filled "Send message" h-8; success/error = alert primitive (3px left rule) not a toast-coloured box.
- **/openclaw** (marketing): centered kicker "OpenClaw skill · Self-hosted · Free" 12/16 600 secondary (drop the blue square); H1 42/50 600 centered, measure 640; dek 20/28 secondary; the phone/WhatsApp mockup is an ILLUSTRATION → wrap its root in `data-rulebook-exempt` (third-party UI facsimile), everything outside conforms; install command block per code rule; CTAs: one filled Klein h-10 in the hero region, others ghost; feature grids → flat panels, no icon tiles; testimonials/quotes → 20/28 400 with 3px Klein left rule.
- **/privacy, /terms**: 32/40 H1; "Last updated …" 14/20 secondary; sections 20/28 600; body 16/22; measure 640; no `prose` grey/rounded/shadow (bind prose to tokens, clause 8); tables per rule.

## D2 — company pages (/co/[slug], /companies/[slug]; before 117/77)
- Breadcrumb bar: h-10, hairline bottom, 14/20: "Find jobs" Klein link, "/" secondary, current secondary. No band bg.
- Header: CompanyInitialTile 48×48 hairline square (glyph exempt already); name 32/40 600 ink (not 42: this is a product page with content heading); status line 16/22 ink with the 8px --live square dot ("82 open roles live on velai right now" — keep the dash-free wording, sentence case); facts row 14/20 secondary joined by " · " with NO icons (domain = Klein link, "Hiring in United States, India, United Kingdom", "2% of roles remote"); "Follow this company" = the page's ONE filled Klein h-8, right-aligned.
- Open roles: heading 20/28 600 + "10 of 82 shown" 14/20 secondary on the same row; search = field-01 h-10 (40px allowed) with 16px magnifier, placeholder #8D8D8D; list = ROWS not cards: no per-item border; inset hairline separators; py-16; title 16/22 600 ink; meta 14/20 secondary "USD 160k–190k/yr · New York, United States · Onsite" (pay NOT bold); "View role" Klein text (no arrow) right-aligned; hover bg layer.
- Right rail follow gate: REMOVE the blurred/ghosted preview (translucency + blur banned); flat panel hairline p-24: title 16/22 600, body 14/20 secondary, "Followers only" 12/16 600 secondary plain text (no dotted border, no lock icon, no uppercase). Signed-in followers see the same panel filled with the history table per table rule.
- Anything reused from /jobs (status words, verdict words, pay text) must come from the Group C components, not copies.
## D2 — /watch/anywhere, /watch/[id]
- Same product anatomy as GROUP-E page header (20/28 600 title + 14/20 secondary) — these are product pages; lists = rows with inset separators; alerts = GROUP-B alert primitive; one filled per region; /watch/[id] verified by tsc + banned-class lint + code read (signed-in only; ledger says so).

## Deletions allowed
Only: unused icon imports, dead badge/pill class strings, the "→" literals, decorative SVG/emoji nodes named above. Do NOT delete components, routes, copy paragraphs, data, tests, or design assets.

## Verify (coder runs, returns ≤40 lines)
1. `npm run test:design` (Group A gate) clean for the touched files; `npx tsc --noEmit -p tsconfig.json` exit 0.
2. `cd $SP && NODE_PATH=/Users/vivek/Antigravity/Code/interview-os/node_modules node route-probe.cjs routes.json $SP/groupD --base=http://localhost:3000` for each route in this group (pass the route substring); target = 0 violations desktop + mobile per route; paste the before→after table (route | before d/m | after d/m).
3. Screenshots land in $SP/groupD/shots/ledger/; Fable views them.

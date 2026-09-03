# GROUP E — product + account pages (Fable spec, Sep 3 ~01:05 EDT; from before-shots stories/resume/yours/login)
Rulebook: canvas2/RULEBOOK.md v1 + v2 clauses. Build ONLY with GROUP-B primitives (button/input/tabs/alert/dialog/skeleton/card).

## Routes
/resume (+ layout.tsx + loading.tsx) · /yours · /yours/[id] (signed-in) · /yours/history · /stories · /login · /reset-password · /oauth/authorize · /settings (server-gated) · /account (→ /login) · /admin (→ /login)
Gated states (/yours/[id], /settings, /account, /admin, signed-in /resume,/yours,/stories): code-level conformance (primitives + lint + tsc) — the ledger must say "code-verified; pixels on prod after deploy", never "pixel-verified".

## E-anatomy
| Element | Before (measured) | Target |
|---|---|---|
| Page header | full-width grey band, 28–32px 700 title, 14–15px subtitle, right-side filled button | page bg (NO band), hairline bottom, py-24 (mobile py-16): title 20/28 600 ink, subtitle 14/20 secondary, ONE filled Klein h-8 right (e.g. "Track a role", "Upload resume"). Same anatomy as the /jobs detail title (PLAN-v2 C) |
| Tabs (Tracker / History) | black underline tabs | GROUP-B line tabs: h-10, 14/20, active ink + 2px Klein bottom, inactive secondary |
| Search field | bordered input, 40px | field-01 h-8 (h-10 only where it is the page's primary control), 16px magnifier, placeholder #8D8D8D |
| Empty state (blank slate, ui-patterns.com) | bordered/dashed card, 48px icon tile (grey or blue tint), 700 title, filled CTA | flat panel: page bg, 1px hairline, p-32, centered, max-w 480; icon = ONE 24px secondary glyph or none (no tile, no tint); title 16/22 600 ink; body 14/20 secondary; primary CTA = OUTLINE h-8 when the page header already holds the filled button, FILLED h-8 when the header has none; second action ghost |
| Dashed borders (/resume upload) | 2px dashed grey | 1px hairline solid; drop zone hover = layer bg |
| Light-blue tints (/yours) | `bg-blue-50`-style panels | layer #F4F4F4 or page + hairline |
| Lists (tracker rows, history, stories) | cards with borders, status pills | rows, inset hairline separators, py-16; title 16/22 600; meta 14/20 secondary " · "-joined; status = WORD in status colour (Applied / Interviewing / Offer in ink; Rejected in secondary; Ghosted in warn; Live in --live) |
| Builder chrome (/resume editor, `src/components/resume-builder/ResumeEditor.tsx` fixed bottom bar) | translucent/blurred bar, shadow | opaque page bg, hairline top, h-12, ONE filled "Save" h-8, others ghost; no blur/shadow |
| Forms (settings/account/contact) | mixed inputs | field-01 inputs, labels 12/16 secondary above, help 12/16 secondary below, errors 12/16 in red-60 below the field (inline validation), section headings 16/22 600, one filled per form region |
| Icons | icon tiles, icon-per-fact in rows | 16px currentColor only where meaning is carried; none in fact rows |
| Toasts / notices | coloured boxes | GROUP-B alert (3px left rule by status, layer bg) |

## Per-page
- **/stories** (guest empty state; signed-in = saved interview answers list): header "Your stories" 20/28 + subtitle 14/20; empty panel per rule with "Sign in" as the FILLED CTA (header has no button for guests) — but the page must have only one filled control overall.
- **/resume** (35/40 before): header "Resume" + filled "Upload resume"/"Create"; upload card → hairline panel; tips list = plain 14/20 rows; layout.tsx/loading.tsx skeleton = bg-muted pulse blocks matching the header (28px) + panel (160px) heights; builder chrome per rule; section list in the builder = line rows with 16px drag handle only.
- **/yours** (30/37 before): header "Your tracker" + filled "Track a role"; line tabs; field-01 search; empty state with OUTLINE "Browse verified roles"; tracker rows per list rule; status words not pills.
- **/yours/history**: same header; history rows: date 14/20 secondary (tabular), title 16/22 600, status word.
- **/yours/[id]** (signed-in): detail = /jobs detail anatomy reused from Group C components (title 20/28 600, disclosure rows), notes textarea field-01, one filled "Save".
- **/login, /reset-password, /oauth/authorize** (49/49 before each — shared shell): centered column max-w 400, no card border on desktop ≥ 768? Keep a hairline panel p-32 (consistent with empty state); wordmark exempt; title 20/28 600 ("Sign in to velai"); body 14/20 secondary; provider buttons = OUTLINE h-10 full-width, 16px provider glyph left (third-party brand glyph → `data-rulebook-exempt` on the glyph element only), sentence case ("Continue with Google"); divider = hairline with "or" 12/16 secondary; email field-01 h-10; ONE filled Klein h-10 "Continue with email"; footnote 12/16 secondary, links Klein. /oauth/authorize: app name 20/28 600, "wants to access your velai account" 14/20 secondary, scopes = plain rows with hairlines and NO icons, "Allow" filled h-10 + "Cancel" ghost. Error/expired states = alert primitive.
- **/settings** (gated; `src/components/settings/SettingsContainer.tsx` has a fixed bottom bar → same builder-chrome rule), **/account, /admin**: apply primitives; tables per GROUP-D table rule; danger actions = destructive variant (red-60 fill) ONE per region, confirm via dialog primitive.

## Deletions allowed
Only: unused imports, dead badge/tile/tint class strings, decorative icon nodes named above. Never components, routes, copy, data, tests, assets.

## Verify (≤40 lines back)
1. test:design + tsc clean.
2. route-probe (see GROUP-D §Verify) on /resume /yours /yours/history /stories /login /reset-password /oauth/authorize (and /settings /account /admin as redirect/gated rows) → before→after table, target 0/0.
3. For gated pages: paste the `grep -nE 'uppercase|tracking-|shadow-|blur|/[0-9]{2}\b|rounded-(?!none)|text-\[' ` count per file = 0.
4. Screenshots in $SP/groupE/shots/ledger/ (desktop + mobile).

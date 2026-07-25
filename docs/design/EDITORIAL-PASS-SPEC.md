# Editorial Pass — "Verification Instrument"

Supersedes the visual layer of PORTAL-REDESIGN-SPEC.md. All DATA-HONESTY rules, route mappings,
and cut-features from that spec still apply verbatim — this pass changes how things look, not
what data appears. Vivek's verdict on the shipped portal look: templated ("vibecoded"). This
charter inverts it. The subject grounds the direction: intervu inspects job listings and reports
evidence. The UI is the inspection document, not a SaaS shell.

## Anti-marker rules (HARD — violating any of these recreates the problem)

1. NO cards. No bordered rounded boxes floating on a background. Structure = horizontal rules,
   column alignment, whitespace asymmetry. One continuous page surface.
2. Border-radius 0 everywhere. No shadows. No hover-lift. Hover = ink inversion or underline,
   transitions ≤120ms or none. Remove the ivPulse animation and all status-dot jewelry.
3. NO pills. Filters/toggles are text: underlined when active, with live counts in parens.
4. NO big-number stat tiles. Numbers live inline in mono sentences or ruled table rows.
5. NO centered empty states. One left-aligned sentence in the content column, action inline.
6. NO decorative icons/emoji (briefcase, alarm, sparkles). Functional glyphs only: ■ ▲ ✕ ▾ ←.
7. NO marketing headline inside the tool. The working surface starts immediately.
8. Color appears ONLY in the verdict channel (see palette). Links, buttons, nav, brand: ink.

## Palette (tokens — remap existing var names again, values only)

Light ("paper"):        Dark ("carbon" — a decision, not a dim):
- background  #FEFEFC   #131211
- surface     #FEFEFC   #131211   (same — no banded surfaces)
- foreground  #161513   #ECEAE4
- secondary   #45423B   #B5B2A8
- muted       #767268   #8A867B
- rule/border #D8D6CF   #33312C
- rule-strong #161513   #ECEAE4   (section-lead rules are ink)
- verdict-live    #2E6B4F   #5E9C7E
- verdict-caution #9A6B10  #C29441
- verdict-risk    #A93E28  #C86A54
- verdict-live-bg    #EDF3EF  #1B2420  (row-tint only, optional, subtle)
- verdict-caution-bg #F5EFE1  #262117
- verdict-risk-bg    #F6EAE6  #271B18
Primary button: solid ink bg / paper text. Everything else: text.
Accent-picker: add + default to a "carbon" preset (ink accent); green preset stays available.

## Type

- Display: Archivo, weight 800-900, tight tracking (-0.02em), used ONLY for the wordmark and
  one heading per page. Violent size contrast (28-40px) against an otherwise small UI.
- UI/body: Archivo 400/500/600 at 13-15px, tight line-heights (1.35-1.45). Density is a value.
- Data/meta/verdicts: IBM Plex Mono 400/500, 11-12.5px, tabular-nums. EVERY number, timestamp,
  count, and verdict is mono. This is the page's texture.
- Micro-labels: mono 10px uppercase +0.08em, used sparingly and consistently (column heads only).
- All via next/font/google: Archivo, IBM_Plex_Mono. Remove Bricolage Grotesque + Spline Sans +
  Spline Sans Mono.

## Layout — jobs page (/)

Masthead (one ruled row, ink rule 1px full-width below): wordmark "intervu" (display, ~20px) +
mono "BETA" + tab nav as plain text (active = ink + 2px ink underline; inactive = muted) +
right: theme toggle (text: "night"/"day"), avatar/login. No live-count in masthead.

Control band (below masthead, ends with an ink rule):
- Search input as a DOCUMENT LINE: full-width, no box — just a bottom rule with mono
  placeholder; typed text 16px Archivo. [SEARCH] as solid ink rectangle, mono label. Location +
  work-mode as inline text-selects (mono, underlined value, ▾).
- Legend line (mono, 12px): active filters as underlined text with counts, e.g.
  "ghost-risk hidden (−12) · new this week · salary $100k+ · senior · filters +  |  reset".
  Same URL-state wiring as today (pills → text affordances 1:1).
- Sort: mono text trio "freshest / top pay / best match" — active underlined ink.

The ledger (the hero — starts within the first viewport):
- Column-head row (micro-labels, mono): ROLE · COMPANY · TERMS · POSTED · VERDICT, hairline under.
- Job row (dense, ~64-72px): line 1 = title (Archivo 600 15px) + company (500, secondary);
  line 2 = mono meta: work_type · location · salary range · level. Right-aligned fixed-width
  VERDICT CELL (the signature): mono, colored, e.g. "■ LIVE · 2H" / "■ CHECKED · 3D" /
  "▲ REPOST" / "▲ CAUTION" / "✕ RISK · STALE 47D" / "— UNSCORED" — composed from the same real
  signals as before (ghost_badge + badgeFor/checkFreshness + classifyPostingFreshness).
  Optional subtle full-row bg tint from verdict-bg tokens on caution/risk only.
- Row hover: background steps to a hairline-gray; whole row opens the existing detail Sheet.
  Save (♥→ text "save"/"saved" mono underline) + "apply" mono underline right of verdict or in
  row line 2 right — keep existing pursuits wiring + testids (job-title, pursuit-row etc).
- Hairline rule between rows; NO gaps, NO boxes. "Show N more ↓" → mono text line, underlined.
- Result count: mono line above column heads: "N roles · M flagged this search" (real counts,
  same sources as current ghostHiddenCount/corpus-count).

Rail (right, 300px, separated by a vertical hairline — not a card stack):
- "Pipeline" as a ruled section: mono sentence with linked counts ("0 saved · 0 applied · ...")
  then up to 3 pursuits as two-line text entries (same real data), "open tracker →" text link.
- "Ghost radar" as a ruled section in INK TEXT (no dark panel): the same real facet numbers as
  one paragraph, numbers mono.
- Nothing else. (Alert cards stay dead per portal spec.)

Keep intact: URL-as-state, server actions, FilterPanel sheet ("filters +" opens it), detail
Sheet at all breakpoints, outage/unavailable state (restyle: left-aligned ruled section, mono,
"Retry" as underlined text), pagination sentinel, recent-searches, guest pursuits.

## Other pages (phase 2 — after Vivek approves the jobs screenshot)

Tracker: stat tiles → one ruled mono summary row; board columns → four ruled list columns with
hairline verticals, rows as text entries; closed = ruled section. Resume: version cards → ruled
list rows; paper preview keeps a single hairline frame (no shadow); sidebar → ruled sections.
Prep: ink hero panel → ruled section with an ink [START SESSION] rectangle; progress bars →
mono fractions ("8/24"). Shell change applies everywhere immediately (masthead + tabs).

## Voice

No marketing lines inside the tool. Empty states state the fact + the action:
"Nothing saved. Save a role from the ledger and it appears here." Errors name the failure and
the fix. Buttons say the action: SEARCH, APPLY, START SESSION.

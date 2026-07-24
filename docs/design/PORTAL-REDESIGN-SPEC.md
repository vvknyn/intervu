# Portal Redesign — Implementation Spec

Source design: `docs/design/intervu-portal.dc.html` (Claude Design export, "Intervu Jobs.dc.html").
Read the design file for exact layout/spacing/typography of each screen. This spec covers the
**adaptations** — where the mock's fake data meets the real app — and the token/font system.
Where this spec and the mock conflict, this spec wins (it encodes data-honesty decisions).

## Hard rules

1. **No invented data.** Every number, timestamp, and status label rendered must come from a real
   field. The mock's fake stats (ATS score, response rate, "412 flagged this week", "recruiter
   viewed", "no tracked hires", repost counts) are CUT or replaced per the page sections below.
2. **No behavior regressions.** URL-as-state, pursuits store, prep session flows, resume autosave,
   auth/guest states, theme toggle, credits, feedback modal all keep working. Restyle ≠ rewire.
3. **Server actions / lib code untouched** unless a section below explicitly says otherwise.
   This is a presentation-layer rebuild.
4. **Both themes.** Every new surface uses tokens (below) — never raw hex in components. Verify in
   light AND dark.
5. Existing e2e specs reference the old DOM; breaking selectors is expected — QA task will update
   the specs. Preserve `data-testid` attributes where they exist; move them onto the equivalent new
   elements.

## Fonts (layout.tsx)

Replace Hanken Grotesk + Geist Mono via `next/font/google`:

- `Bricolage_Grotesque` → `--font-display` — headlines, wordmark, stat numerals, card titles
  (mock uses weights 500/600/700).
- `Spline_Sans` → `--font-sans` — body/UI (400/500/600).
- `Spline_Sans_Mono` → `--font-mono` — meta lines, labels, badges, timestamps (400/500/600).

Map in globals.css `--font-sans` / `--font-mono`; add `--font-display`. Utility class or
`font-display` Tailwind alias for the display family.

## Design tokens (globals.css — keep existing var NAMES, change values; add new vars sparingly)

| Role | Light | Dark |
|---|---|---|
| background (page) | `#F6F5F0` | `#14130F` |
| surface (topbar / hero band) | `#FBFAF6` | `#1A1915` |
| card | `#FFFFFF` | `#201F19` |
| border (card) | `#E5E2D8` | `#33312A` |
| border-strong (inputs) | `#DCD8CB` | `#3E3B30` |
| foreground / ink | `#1C1B16` | `#F1EFE6` |
| fg-secondary | `#3E3B30` | `#CBC7B8` |
| muted | `#6E695B` | `#8A8574` |
| faint | `#8A8574` | `#6E695B` |
| brand / links | `#0E6B4C` (hover `#0A4F38`) | `#3ECF8E` (hover `#5BDBA4`) |
| live / positive dot | `#0F8A62` | `#3ECF8E` |
| green tint bg | `#EDF6F0` (alt `#E6F1EC`) | `#0C2B1E` |
| green tint border | `#BFDCCB` | `#1E4835` |
| warn | dot `#C98A1B`, text `#92600A` | `#E2A93B` both |
| danger | `#B3452F` (tint border `#ECC9C0`) | `#D06A54` (tint border `#5C2D24`) |
| chip / segmented bg | `#EDEBE2` | `#2A2922` |
| ink-card (dark panel on any theme) | bg `#1C1B16`, fg `#FBFAF6`, body `#CBC7B8`, accent `#3ECF8E` | same + 1px border `#33312A` |

Existing status vars (`--st-*`) get remapped onto live/warn/danger/muted equivalents.
Primary buttons: ink bg (`#1C1B16`) / cream text, hover `#33312A`; in dark: cream bg / ink text.
Outline buttons: 1.5px ink border, hover inverts. Radii: cards 12px, inputs/buttons 8–10px,
pills 100px. `ivPulse` keyframe (green pulse) added to globals.

## Shell (TopBar)

Tabs (always visible, active = ink text + 2px `live` underline, inactive = muted):
**Find jobs** `/` · **Tracker** `/yours` (no longer conditional on hasPursuits) ·
**Resume** `/resume-builder` · **Interview prep** `/prep`.
Keep: wordmark + beta badge (restyled per mock), theme toggle, avatar dropdown (credits, Stories,
Settings, Feedback, sign out), "Log in" when signed out. CUT from mock: "2,318 live roles" in the
top bar (no independent live-roles metric; counts live on the jobs page). Mobile: tabs collapse to
existing responsive pattern — do not orphan any destination.

## Page: Find jobs (/)

- **Hero**: "Find work that's real." + mono subline. Subline stat must be real: use the
  `ghost_badge` facet counts from the current unfiltered corpus if cheaply available (e.g.
  "Every listing checked for ghost-job risk · N flagged right now"); otherwise just
  "Every listing checked for ghost-job risk." CUT "Save this search as alert" (no email backend).
- **Search row**: q input (real), location select ← `location_country` facet (no city-level filter
  exists — do NOT fake one), mode select ← `work_type` facet, Search button submits via existing
  URL-state flow.
- **Pills**, each mapped to existing `JobsUrlState` only: "No ghost risk ✓" ← `hideGhosts`
  (default true — active pill state matches mock), "New this week" ← `postedBucket=7d` (use the
  nearest real bucket), "Salary $100K+" ← `salaryMin` tier (replaces mock's "Salary listed" —
  closest real filter), "Senior level" ← `experience_level`, "All filters ⚙" opens existing
  FilterPanel, "Reset" restores defaults. CUT "Easy apply" (no field).
- **Sort segmented control** (mono, chip bg): `freshest` ← newest, `top pay` ← salary_desc, plus
  `best match` ← relevance/fit so no existing mode is lost.
- **Job cards** per mock layout: initial tile (deterministic pastel bg from company name — pick
  4–6 token-compatible pairs), title, company · work_type · location, salary range (only when
  salary_min/max present; omit the segment otherwise — never "salary not listed" unless design
  copy is wanted: use mono muted "salary not listed" as in mock, it is honest), experience_level.
  **Flag row** (dot + mono label) from real signals ONLY:
  - `ghost_badge=clear` + fresh per `checkFreshness` → live dot (pulse) "Live — verified {age}"
    (age from `updated_at` via existing `badgeFor` machinery)
  - `clear` but stale-checked → live dot (no pulse) "checked {age}"
  - `caution` → warn "Ghost risk — {relisted per classifyPostingFreshness ∥ stale {N}d from
    posted_ts}" — compose only from signals that fire; generic "Ghost risk — caution flag" if none.
  - `likely_ghost` → danger "High ghost risk — {same real qualifiers}"
  - `unscored` → faint dot "not yet scored"
  Heart toggle ← pursuits save (interested stage, existing Go-after wiring; filled heart when
  `byJobId` hit). Apply button ← existing apply flow (`apply_url`). Posted-ago ← `posted_ts`.
  Keep existing job-detail open behavior (jobId in URL) on card click.
- **Results header**: "Top matches" + mono "{shown} of {total} · {q or 'all roles'}" from real
  result counts (`resolveCorpusCount`). Load-more control restyled ("Show N more ↓") on the
  existing pagination mechanism.
- **Sidebar**:
  - *Your pipeline* card: stage tiles Saved(=interested+resume_ready) / Applied / Interview /
    Offer counted from `usePursuits()`; highlight tiles with count>0 (green tint). Below: up to 3
    pursuits by `orderPursuits`, each with real status mono line derived from stage + timestamps
    (e.g. "applied {N}d ago"); no "listing went inactive" claims (no detection exists).
    "Open tracker →" → /yours. Renders for guests too (guest store exists).
  - *Ghost radar* ink-card: real counts from the CURRENT search's `ghost_badge` facet
    distribution: "Of {total} matches for this search, {flagged} carry ghost-risk flags." +
    one factual sentence about what flags mean. CUT "last sweep · today 06:00 EST" and
    "no tracked hires".
  - CUT *Weekly alert* card entirely (no alert backend).

## Page: Tracker (/yours)

- Header "Application tracker" + mono subline "{N} pursuits" (CUT "last 90 days" + filter
  dropdowns — no time-window filtering exists).
- **Stat cards** (4): Applied / Interviewing / Offers / Closed(rejected+withdrawn) — pure stage
  counts. CUT response-rate, median-first-reply, went-inactive (no backing data).
- **Board** (4 columns): Saved(interested+resume_ready) / Applied / Interviewing / Offer.
  Cards: title, company · mono "{stage-appropriate timestamp}" (`applied_at`, `interview_date`,
  `created_at`), status line from `nextAction()` (real actions: tailor/apply/set_interview/prep).
  Card click → `/yours/[id]` (unchanged). Empty-state dashed cards per mock (copy adapted, e.g.
  Saved: "Nothing saved yet — tap ♡ on a match to park it here." linking `/`; Interviewing: link
  `/prep`; Offer: plain copy without comp-benchmark promise).
- Closed pursuits (rejected/withdrawn): compact collapsed list under the board — data must stay
  reachable.
- `/yours/[id]` inherits tokens; no structural rebuild this pass.

## Page: Resume (/resume-builder)

- Header "Resume" + mono subline "{1+N} versions" (base + tailored count from
  `fetchTailoredVersions`); "Export PDF" ink button → existing `window.print()` flow.
- **Version cards row**: base resume card (active-border when selected) + one card per real
  tailored version (name, mono created-at; CUT "ATS score 94" and "87% match" — no such metrics)
  + dashed "+ New version" → existing tailor entry (`/resume-tailor`).
- Resume preview: existing `ResumePreview`/editor components restyled to tokens inside the mock's
  paper-card wrapper. Do not rebuild editor internals.
- **Sidebar**: *Tailoring* card — if the selected version has stored `TailoringRecommendation`s,
  list them (priority-colored chips/rows, real titles); CTA "Open tailor →" → `/resume-tailor`.
  CUT keyword-match %, missing-keywords chips, ATS-scan ink-card (all ABSENT in data model).
- /resume-tailor itself: tokens/shell inheritance only this pass.

## Page: Interview prep (/prep)

- Restyle **PrepLanding** to mock's layout: header + mono subline; ink-card hero "Mock interview"
  → existing start-new-session flow (copy describes the REAL Learn/Practice modes — no
  "scored against real screen rubrics" claim); grid of real entry points (start new / search
  plans / resume session / cached packages) styled as the mock's bank cards — show real progress
  (reviewed/practiced counts) where the cached session data provides it, no fake "8 of 24".
- Recent sessions card: only if real cached session summaries (scores /10 from PrepSummary data)
  are available locally; otherwise omit the card. Never fabricate scores.
- Sidebar: *Story bank* card ← real story count/status from the stories store, linking `/stories`.
  CUT "Question of the day" (no such feature).
- Deep session views (setup, mode selection, session, summary): token inheritance only this pass;
  no structural changes to DashboardContainer internals beyond what PrepLanding requires.

## Company-initial tile palette (light/dark safe)

Pairs (bg/fg): `#E8EDF6/#2B4A7E`, `#EFE8F6/#5B3A8E`, `#E6F1EC/#0E6B4C`, `#F6EDE4/#8E5B2B`,
`#F6E8E8/#8E2B2B`, `#EDEBE2/#3E3B30`. Dark theme: same fg on `#2A2922`-based tints or keep pairs
(they read as pastel chips) — pick once, apply deterministically (hash of company name).

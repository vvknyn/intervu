# intervu Design Language — the single source of truth

**This document supersedes every other design spec in this repo.** If anything below conflicts
with an older file, this wins. The older passes are archived context only. The one live exception
is `docs/design/rulebook-2026-09/RULEBOOK.md`, which this document does not supersede: this file
governs look, tokens, radius, type and components; RULEBOOK.md governs the spacing axis, grid and
header height.

| Superseded | What it was |
|---|---|
| `PORTAL-REDESIGN-SPEC.md` | Aug 2 portal pass. Stale: specs `/` as "Find jobs" (it is now the front door), specs `/resume-builder` and `/prep` (both deleted), specs 12px radii (we are squared). **Superseded visually only** — this document is visual-only and does not restate that spec's data-honesty decisions, which remain live there. |
| `EDITORIAL-PASS-SPEC.md` | "Verification Instrument" pass — another remap of the same var names. |
| `soft-signal-desktop/`, `soft-signal-mobile/`, `soft-signal-feed/` | Mockup sets with their own `_system.css`. |
| `elite-company-signal/` | Mockups behind the `.elite-signal` scope. |
| `docs-mockup.html` | Cited by `globals.css:273,529` as "THE RULES" for the squared pass — **not present in this repo**. Its one surviving rule (radius 0) is restated below, so nothing depends on the missing file any more. |

Why this exists: six design passes each remapped the same token names to different values, so
there was no current document to arbitrate with and every change drifted. One document, or it
happens again.

## Decisions (owner, 2026-09-26) — Concept A skeuomorphic system

1. **The signed-out Concept A landing (`ConceptALanding.tsx`) is the canonical visual language**
   for the whole product — dark charcoal surfaces (`--surface-poster` / `--background`), cream
   postcard accents (`--surface-postcard`), **green live accent** (`--brand` / `--live` =
   `#0E9F4E`), **title-case `Velai`**, rounded panels and pills, and **sanctioned depth**
   (`--shadow-overlay`, `--shadow-postcard`, `--shadow-surface-raised`, bevel inset/highlight).
2. **The paper / Klein-blue / shadow-none stack is retired.** `--brand` is green, not Klein blue;
   elevation is allowed only through the semantic shadow tokens above (Tailwind's named
   `shadow-*` scale remains `none`).
3. **The app mark never sits on a white tile** — `public/velai-logo.png` and every derived icon
   use a dark skeuomorphic tile or transparency (`--surface-mark-tile`).
4. **One z-index ladder** in `globals.css` (`--z-topbar` … `--z-toast`); call sites consume
   `z-[var(--z-topbar)]` (and the other named ladder steps), not ad-hoc numbers.

See `docs/design-language-rollout.md` (project store) for phased surface rollout and WCAG targets.

## Decisions (owner, 2026-08-04)

1. **The marketing surface takes its composition from ollama.com** — near-monochrome, generous
   whitespace, colour used scarcely.
2. **Dark-only** — Concept A charcoal is the only shipped surface; there is no user-facing
   light/dark toggle. (ollama.com has none; we are not copying that either.)
3. **Radius stays 0 everywhere.** Squared is our signature. (ollama.com is pills; we are not
   copying that either.)
4. **Primary buttons are ink, not brand-coloured.** The accent survives as a sparing accent for
   links, live states and small marks — the same role ollama gives its one blue.

   **Amended 2026-08-17.** This clause said "the green" until PR #217 (`49b0448`, Swiss Tinted
   Glass) moved `--brand` from `16 149 106` to `0 47 167` and took the neutrals off the slate
   ramp. The accent is **International Klein Blue `#002FA7`** in light and Electric Klein Blue
   `#2D68FF` in dark; there is no green in the system. Nothing downstream of `--brand` followed
   that change at the time, which is what the amendments below repair. Decisions 1–3 are
   unaffected.

The result is deliberately not an ollama clone: their restraint, our geometry.

## One visual world

There is exactly one theme system. A surface may not introduce its own palette scope.

The `.openclaw` night scope (`src/app/openclaw-marketing.css`) exists only because the front door
was built as a separate visual world; it remaps `--background`/`--foreground`/`--brand` to a
coral/violet night palette and forces dark regardless of the user's toggle. **That is the cause
of the "doesn't feel like the same product" jump from landing to search, and it is retired.**
Marketing pages use the same tokens, the same shell, and the same dark-only chrome as the app.

**Done (2026-08-04, one-visual-world PR):** `openclaw-marketing.css` is deleted (nothing needed
its `--oc-*` accents once the core-token remaps came out — the ones that did, like the front
door's status-line dot, now read `--brand`). `/` and `/openclaw` render in light by default and
follow the toggle. There is also exactly one nav component now — `TopBar`, mounted once in the
root layout on every route including `/` — `FrontDoorNav` (a second brand-mark/nav
implementation that duplicated `TopBar`'s `layoutId`-based brand mark for a cross-page morph that
had already gone dead) is deleted, and the now-uncontested `MotionRoot`/`LayoutGroup` wrapper it
existed for went with it.

Scoped remaps of core token names are forbidden. If a surface needs a distinct treatment, it
composes from the tokens below — it does not redefine them.

## Tokens (`src/app/globals.css` — the only place values live)

Colour is defined once as RGB triplets in `:root` and `.dark`, exposed to Tailwind through the
`@theme inline` block. **Never write a raw hex or a Tailwind palette class (`bg-white`,
`text-slate-500`) in a component.** Current semantic names — `--background`, `--surface`,
`--surface-2/3`, `--card`, `--border`, `--border-strong`, `--foreground`, `--muted-foreground`,
`--faint`, `--chip`, `--brand`, `--brand-foreground`, `--brand-muted`, plus the status channel
(`--verdict-*`, `--st-*`) — keep their names. Only values change.

- **Radius: 0.** All nine `--radius-*` keys are `0px`. `rounded-full` and arbitrary
  `rounded-[Npx]` bypass the theme, so they are banned in components except where a shape is
  genuinely circular (avatars, dots, spinners) — plus one standing exception:
  `WhatsAppThreadHero`'s `rounded-[30px]` phone bezel, because it depicts a literal phone and a
  phone has rounded corners. That component is otherwise a self-contained artifact (its own
  fixed WhatsApp hex colours, not theme tokens) that must never leak its palette onto the page
  around it — elevation still applies to it though: no exception on `shadow-*` there.
- **Elevation: reserved exclusively for overlays.** A shadow means "this floats above the page."
  *Every* named-scale `--shadow-*` key Tailwind ships is `none` — `2xs`, `xs`, `sm`, `md`, `lg`,
  `xl`, `2xl`, `inner`. Not "every key we happen to have written down": that reading is what left
  `2xl` casting Tailwind's stock shadow for a fortnight. Separation for every in-flow surface comes
  from a 1px `--border` and whitespace — ollama's rule, and it suits a squared system — and hover
  affordance in-flow is border-darkening by default, not a lift. Never `shadow-lg`, `shadow-2xl`, or a raw
  named-scale `shadow-*` class.

  **Amended 2026-09-27 (interactive Card).** Static in-flow `<Card>` surfaces stay flat: bevel inset
  (`--shadow-bevel-highlight`) only, no hover lift — they must not read as clickable. The foundational
  `<Card interactive>` opt-in alone may compose `.interactive-lift` and transition to
  `--shadow-surface-raised` on hover (fine pointer); that is the only sanctioned in-flow lift. All
  other in-flow cards and paper surfaces keep border/whitespace separation only.

  The one deliberate exception is `--shadow-overlay` (`globals.css`, `:root`/`.dark`) — not part of
  Tailwind's scale, so the "none" rule above doesn't reach it. It is the single standard shadow for
  surfaces that render with nothing behind them: `dialog.tsx`, `sheet.tsx`, `tooltip.tsx`,
  `select.tsx`'s floating content (not its in-flow trigger, which stays scale-`none`),
  `dropdown-menu.tsx`, `popover.tsx`, and `SearchAutocomplete`'s results dropdown, each applied as
  `shadow-[var(--shadow-overlay)]` — one mechanism, everywhere it's used. See
  `docs/design/ATTENTION.md`.

  **Amended 2026-08-17.** The 2026-08-04 pass zeroed `sm/md/lg` in `:root`/`.dark` but left
  `2xs`, `xs` and `xl` at their live slate-tinted values in `@theme inline`, where no `:root`
  override existed to flatten them. `shadow-2xs` is the most-used shadow in the app (33 call
  sites), so elevation was on the whole time this document said it was off. Every key now has
  exactly **one** declaration, in `@theme inline`, all `none`. That matters beyond tidiness: they
  had been declared twice with different values, and which one won depended on Tailwind v4
  hoisting `@theme` above `:root` — a cascade detail no reader should have to know.
  `--shadow-glow` was deleted outright: defined once, referenced nowhere, and still carrying the
  retired emerald.

  **Amended 2026-08-20.** The rule above used to be an absolute — elevation is none, full stop —
  and two things had grown around that absolute rather than through it: `.glass-panel`/
  `.glass-card` (job rows, the LaunchBanner) cast a real `0 10px 30px` outer drop shadow plus a
  hover-lift `translateY`, and `SearchAutocomplete`'s dropdown compensated for having no elevation
  to borrow with an extra-strength border instead. Both were real elevation the document said
  didn't exist, on top of ~30 arbitrary `shadow-[...]` utilities across `src` bypassing the zeroed
  scale entirely. The fix is the `--shadow-overlay` exception above, not a wider absolute:
  `.glass-panel`/`.glass-card` dropped their outer shadow and their hover lift (they separate by
  border + inset sheen only now, and `.glass-card:hover` darkens the border, nothing more), and
  every genuine floating overlay — including `SearchAutocomplete`, which keeps its full-strength
  border alongside the new shadow — now casts exactly `--shadow-overlay`. Every remaining
  arbitrary `shadow-[0_...]` on an in-flow element was swept to flat (or, where it was the only
  separator, a 1px border). `tests/unit/design-language.test.ts` guards both halves: the
  `.glass-panel`/`.glass-card` blocks can never regain an outer layer, and no `shadow-[...]`
  utility anywhere in `src` may cast an outer shadow except as `shadow-[var(--shadow-overlay)]`,
  an inset sheen, or a zero-blur ring.

  "Every key" means **every key Tailwind ships**, not every key this repo had written down. The
  first pass zeroed the six that appeared in `globals.css` and missed `--shadow-2xl`, which was
  never declared here at all — so Tailwind's stock `0 25px 50px -12px` went on rendering on seven
  surfaces under a document that said elevation was off. `--shadow-2xl` and `--shadow-inner` are
  now declared `none` too, and the guard derives its list from
  `node_modules/tailwindcss/theme.css` so a future scale step fails a test rather than silently
  reintroducing elevation.

  **One standing exception**, in `globals.css` and deliberate: `.glass-panel-raised` (PR #219),
  the single focal surface per page — currently `/jobs`' search line. It exists because a page
  whose every surface is separated only by a 1px border gives the reader nothing to enter through,
  which is the defect #219 was opened to fix ("it is just blending in the page"). Use it **once
  per page**. Everything about it is achromatic: its shadow, border and fill were
  `rgba(15,23,42)` / slate-200 against a purely neutral ramp, so the focal panel of the app was
  the bluest thing in it. Elevation is light, and light is grey here. This is a once-per-page
  in-flow spotlight, not a portal-rendered overlay, so it is a separate device from
  `--shadow-overlay` and is not affected by the 2026-08-20 amendment. (`.glass-panel`/`.glass-card`
  themselves used to carry a soft `0 10px 30px` outer shadow here too — retired in that amendment;
  glass legibility over a flat fill now comes from the border and inset sheen alone.)

  Every surface that floats with **no scrim behind it** carries `--shadow-overlay` alongside its
  own edge, rather than trying to borrow definition from a border alone. `SearchAutocomplete`'s
  dropdown is the case that proved a border-only fix wasn't enough: `border-border/50` over
  `bg-popover/95` was invisible the moment `shadow-xl` went to `none`, and the results list
  underneath read straight through it. It now pairs a full-strength `border-border-strong` on an
  opaque fill *with* `shadow-[var(--shadow-overlay)]`. Every other floating primitive —
  `dialog.tsx`, `sheet.tsx`, `tooltip.tsx`, `select.tsx`'s content, `dropdown-menu.tsx`,
  `popover.tsx` — has a scrim or is unambiguously a portal panel, and carries the same token.

  The `.glass-tint-*` chips keep hued shadows and are not a violation — theirs are `inset`
  sheens, which paint the surface rather than lift it. The `instrument-breathe` live pulse *was*
  a violation and is fixed: its ring was `rgba(124,184,122)` — `#7cb87a`, the retired emerald —
  and now reads `--live`.
- **Names describe the role, never the hue** (added 2026-08-17). `--green-tint-bg/-bg-alt/-border`
  had held blue-50/blue-100/blue-200 ever since the accent moved, so the names actively lied.
  They are now `--live-tint-*`, which is what they are: the tint that accompanies `--live`. A
  token named for a colour is how a retired colour gets reintroduced by someone trusting the
  name, and it is the reason six passes could each "remap the same var names to different
  values" without anyone noticing.

- **The brand mark is one artifact with one dot colour** (added 2026-08-17).
  `BrandMark.tsx` centralised the bracket *geometry* and told every other renderer to import it
  — but not the dot's fill, which was hand-copied. Six renderings (`BrandMark`,
  `opengraph-image`, `lib/og/page-card`, `global-error`, `public/mark.svg`, `src/app/icon.svg`)
  carried two different greens, `#7cb87a` and `#6fad6d`, neither of them the brand colour. The
  fill is now `BRAND_MARK_DOT_FILL`, exported beside the geometry and keyed to `--live` (the
  docstring defines the dot as the live signal the brackets hold). In-app the component uses
  `fill-live` so it themes; Satori and the two static SVGs take the literal, because they render
  without a cascade. `src/app/icon.svg` additionally used `#12151a`/`#e8e6e1` — in the palette
  at all — and is now on the `.dark` token values.

- **Motion:** one contract in `globals.css` — read a token for each intent, never an ad-hoc
  Tailwind `duration-*`. Utilities: `.designed-press`, `.interactive-lift`, `.enter-reveal`,
  `.designed-focus` / `.designed-focus-ring`. All motion (including active scale and hover
  lift) collapses under `prefers-reduced-motion`.

| Intent | Token | Typical use |
|---|---|---|
| Instant | `--transition-instant` | Reduced-motion explicit |
| Press | `--transition-press` (100ms) | Buttons, `.designed-press` active scale |
| Base / panel | `--transition-base` / `--transition-panel` (150ms) | Colour, chips, dialogs |
| Enter | `--transition-enter` (200ms) | Mount/reveal (`.enter-reveal`, `.panel-enter`) |
| Deck | `--transition-deck` (220ms) | For-you pack index (later batches) |
| Page | `--transition-page` (180ms) | Home view column crossfade (later batches) |
| Easing | `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` default |

- **Guard:** `tests/unit/design-language.test.ts` enforces the three rules above against the
  rule rather than against a list — a new shadow key, a new hue-named token or a seventh copy
  of the mark fails without anyone remembering to extend an enumeration.

## Type — one scale, used everywhere

Five roles. A component picks a role; it does not invent a size.

| Role | Use |
|---|---|
| `text-display` | The one hero heading on a page. Marketing only. |
| `text-title` | Page and section headings in the app. |
| `text-body` | Default running text. |
| `text-meta` | Captions, labels, timestamps. |
| `.mono-data` | Data strings, IDs, counts — the existing mono utility. |

**Body/UI sans** is **Source Sans 3** on `--font-sans` (`var(--font-sans-face)` from `next/font`
in `layout.tsx`, **static weights 400 and 600** — not the default variable-axis bundle). System
faces remain as fallbacks only. **Mono** and **Libre Franklin** (OG only) still load via `next/font`
as `--font-mono` / `--font-display-face`. **`font-display`** aliases `--font-sans`. **Arbitrary
sizes (`text-[28px]`, `text-[15px]`) are banned in new code.** The audit found five different
mechanisms for an `h1` across public pages alone; that is what this table exists to stop.

**OpenType on `body`:** `font-feature-settings: normal` only — no body-wide character variants
(`cv*`) or stylistic sets (`ss*`). **`font-variant-ligatures: no-contextual`** disables contextual
alternates without reintroducing banned feature overrides. Letter-spacing for body copy stays at the
zeroed `--tracking-*` scale tokens. **`--tracking-label-semibold`** (`-0.01em` today) applies only
to label-sized semibold roles (`text-xs` / `text-sm` / meta/caption/body-sm + `font-semibold`) via
`globals.css` — a minimal static Source Sans 600 sidebearing fix for jobs-hub labels, not a global
tightening. **`--tracking-poster-hero`** may tighten further for the signed-out poster hero only.

**Typography guard (unit tests):** `--font-sans` must keep the `--font-sans-face` prefix,
`layout.tsx` must load Source Sans 3 at 400/600, and tests enforce `font-feature-settings: normal`,
`font-variant-ligatures: no-contextual`, bounded `--tracking-label-semibold`, and zeroed default
`--tracking-*` tokens elsewhere.

**Wordmark:** Title-case **Velai** beside the locked mark tile. Text uses **`text-wordmark`**
(warm white, `#FAFAFA` / `--foreground`) everywhere in app chrome, auth, status pages, and email
header band — never `--brand` green. The raster mark keeps its dark tile and green live dot; favicon
and icon-only assets are unchanged.

## Density — the rule that keeps marketing and app coherent

Marketing surfaces are sparse; app surfaces are dense. This is the one place they legitimately
differ, and it is a spacing decision only — never a palette, type or geometry decision.

- **Marketing** (`/`, `/pricing`, `/about`, `/contact`, `/research/**`): section rhythm 96–160px,
  content column `max-w-5xl`. Whitespace does the work that shadows used to.
- **App** (`/jobs`, `/yours`, `/co/**`, `/settings`, …): section rhythm 16–32px, full width.
  Do **not** carry ollama's 224px rhythm into these screens — it is a single-scroll marketing
  measure and it makes a data surface unusable.

## Components — use the primitive

`src/components/ui/**` is the component layer. If a primitive exists, use it.

Known debt, to be repaid rather than extended (from the 2026-08-04 audit):
- ~16 distinct interactive-control treatments exist: 8 proper `Button` variants plus 8+
  hand-rolled bypasses (the three auth forms hardcode `bg-slate-900`, `TourTrigger`, `TourOverlay`,
  two modal tab-switchers, a stepper).
- 12+ hand-rolled card recipes against 4 files using `<Card>`.
- Three independently built toggle switches in two recipes — **there is no `Switch` primitive;
  build one** rather than writing a fourth.
- 13 files hardcode raw Tailwind palette colours.
- ~~Two competing shadow systems (`shadow-[var(--shadow-sm)]` and plain `shadow-sm`) — both go to
  none.~~ **Partially done (2026-08-04, one-visual-world PR)** — completed 2026-08-17; the entry
  below claimed a repo-wide flattening that only covered three of the six shadow keys, so plain
  `shadow-2xs`/`shadow-xs`/`shadow-xl` kept rendering real elevation. See the Elevation
  amendment above. Original entry: `--shadow-sm/md/lg` are `none` in both
  `:root` and `.dark`, which flattens every call site reading one of those three tokens. The
  plain-class side was swept in the files that PR touched for other reasons — `ui/card.tsx`,
  `ui/button.tsx` (`brand` variant), `ui/input.tsx`, `ui/dropdown-menu.tsx`,
  `ui/popover.tsx`, `FavoritesModal.tsx`, `StoryManager.tsx`, `WhatsAppThreadHero.tsx` — not
  repo-wide. Plain `shadow-*` still remains in `sheet.tsx`, `dialog.tsx`, `tooltip.tsx`,
  `select.tsx`, `tabs.tsx`, `textarea.tsx`, and the resume-builder / applications / admin-panel /
  tour / toast surfaces; the rule below still applies to those the next time a PR is in there.

**Rule: any PR touching one of those files fixes it to the primitive on the way past.** No new
hand-rolled buttons, cards, or switches.

## Visual QA capture fidelity (Playwright / Chromium PNG)

Design screenshots and visual-QA runs use **headless Chromium on Linux** in CI and cloud agents.
Default FreeType font hinting there can **split label glyphs in PNGs** while DOM, computed styles,
and macOS Chromium/WebKit captures stay clean — this is a **capture-engine artifact**, not product
CSS. **`--font-render-hinting=none`** on Linux headless Chromium launch fixes it; **headed Xvfb
does not** (pixels match broken default hinting).

**Do not** remove **`--tracking-label-semibold`** (`-0.01em` on label-sized semibold roles) or
change Source Sans 3 static **400/600** cuts when chasing screenshot diffs.

Shared helper: `scripts/design/linux-chromium-visual-qa.cjs` (`linuxChromiumVisualQaLaunchOptions`).
Wired in `playwright.config.ts`, `scripts/gate-walk-signed-in.mjs`, design `studio/render.mjs`
frame captures, and PNG proof scripts — **not** production PDF/runtime launches unless they take a
fidelity PNG. **Ad hoc captures on Linux:** `chromium.launch(linuxChromiumVisualQaLaunchOptions())`.
Firefox/WebKit and non-Linux hosts skip the flag automatically.

Guard: `tests/unit/linux-chromium-visual-qa.test.ts`.

## Definition of done for a design change

1. Values changed in `globals.css`, not in components.
2. Verified in light **and** dark.
3. No raw hex, no Tailwind palette class, no arbitrary `text-[Npx]`, no `shadow-*`, no
   `rounded-*` beyond genuinely circular shapes.
4. This document updated in the same PR if a decision changed. A design decision that is not
   written here does not exist.

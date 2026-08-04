# intervu Design Language — the single source of truth

**This document supersedes every other design spec in this repo.** If anything below conflicts
with an older file, this wins. The older passes are archived context only:

| Superseded | What it was |
|---|---|
| `PORTAL-REDESIGN-SPEC.md` | Aug 2 portal pass. Stale: specs `/` as "Find jobs" (it is now the front door), specs `/resume-builder` and `/prep` (both deleted), specs 12px radii (we are squared). |
| `EDITORIAL-PASS-SPEC.md` | "Verification Instrument" pass — another remap of the same var names. |
| `soft-signal-desktop/`, `soft-signal-mobile/`, `soft-signal-feed/` | Mockup sets with their own `_system.css`. |
| `elite-company-signal/` | Mockups behind the `.elite-signal` scope. |
| `docs-mockup.html` | Cited by `globals.css:273,529` as "THE RULES" for the squared pass — **not present in this repo**. Its one surviving rule (radius 0) is restated below, so nothing depends on the missing file any more. |

Why this exists: six design passes each remapped the same token names to different values, so
there was no current document to arbitrate with and every change drifted. One document, or it
happens again.

## Decisions (owner, 2026-08-04)

1. **The marketing surface takes its composition from ollama.com** — near-monochrome, generous
   whitespace, colour used scarcely.
2. **Dark mode stays**, on every surface including marketing. (ollama.com has none; we are not
   copying that.)
3. **Radius stays 0 everywhere.** Squared is our signature. (ollama.com is pills; we are not
   copying that either.)
4. **Primary buttons are ink, not brand-coloured.** The green survives as a sparing accent for
   links, live states and small marks — the same role ollama gives its one blue.

The result is deliberately not an ollama clone: their restraint, our geometry.

## One visual world

There is exactly one theme system. A surface may not introduce its own palette scope.

The `.openclaw` night scope (`src/app/openclaw-marketing.css`) exists only because the front door
was built as a separate visual world; it remaps `--background`/`--foreground`/`--brand` to a
coral/violet night palette and forces dark regardless of the user's toggle. **That is the cause
of the "doesn't feel like the same product" jump from landing to search, and it is retired.**
Marketing pages use the same tokens, the same shell and the same theme toggle as the app.

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
  genuinely circular (avatars, dots, spinners).
- **Elevation: none.** `--shadow-sm/md/lg` are `none`. Separation comes from a 1px `--border`
  and whitespace — ollama's rule, and it suits a squared system. Never `shadow-lg`,
  `shadow-2xl`, or a raw `shadow-*` class.
- **Motion:** colour transitions only, 150ms, `cubic-bezier(0.4,0,0.2,1)`. Anything more needs
  a reason written next to it, and must respect `prefers-reduced-motion`.

## Type — one scale, used everywhere

Five roles. A component picks a role; it does not invent a size.

| Role | Use |
|---|---|
| `text-display` | The one hero heading on a page. Marketing only. |
| `text-title` | Page and section headings in the app. |
| `text-body` | Default running text. |
| `text-meta` | Captions, labels, timestamps. |
| `.mono-data` | Data strings, IDs, counts — the existing mono utility. |

Fonts load once in `layout.tsx` via `next/font` and reach components only as `--font-display`,
`--font-sans`, `--font-mono`. **Arbitrary sizes (`text-[28px]`, `text-[15px]`) are banned in new
code.** The audit found five different mechanisms for an `h1` across public pages alone; that is
what this table exists to stop.

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
- Two competing shadow systems (`shadow-[var(--shadow-sm)]` and plain `shadow-sm`) — both go to
  none.

**Rule: any PR touching one of those files fixes it to the primitive on the way past.** No new
hand-rolled buttons, cards, or switches.

## Definition of done for a design change

1. Values changed in `globals.css`, not in components.
2. Verified in light **and** dark.
3. No raw hex, no Tailwind palette class, no arbitrary `text-[Npx]`, no `shadow-*`, no
   `rounded-*` beyond genuinely circular shapes.
4. This document updated in the same PR if a decision changed. A design decision that is not
   written here does not exist.

# Velai design language — one system, Search surface is the reference (decided 2026-09-18)

Reference surface: `/jobs` search (`src/app/jobs/page.tsx`, `src/components/jobs/*`, `src/components/ui/chip.tsx`). Every other surface conforms to it. No second skins: the Carbon 0-radius skin (`rounded-none` on panels/controls) and `.elite-signal` are retired. Tokens come only from `src/app/globals.css`; never add a token, a hex/rgb literal, an arbitrary `[…]` value, a shadow, a blur or a gradient.

## 1. Radius — three roles, never a size name
- `rounded-panel` (16px): any bordered/floating container — engaged search dock, detail pane, suggestion panel, empty-state panel, dialog, sheet (top corners when bottom-anchored), popover, dropdown, logo/avatar tile.
- `rounded-ctl` (12px): every control — button, icon button, input, select, textarea, toolbar segment, tab.
- `rounded-pill`: chips, filter pills, the desktop search field/dock at rest, status dots, spinners, count badges, avatars.
- `rounded-none` is allowed ONLY on list rows and full-bleed dividers (rows sit on the shared inset, they are not cards). Never `rounded-sm|md|lg|xl|2xl|3xl|full`, never `rounded-[…]`.

## 2. Surfaces, borders, focus
- Page ground `bg-background`; content `bg-card`; hover and selected `bg-muted` (selected = hover tint, nothing else); chips `bg-background border-border`.
- One border weight: `border border-border`. Emphasis = `border-foreground` (active chip, focused control). Dashed border only for "nothing here" panels.
- Focus: controls `border-foreground`; dock adds `ring-1 ring-foreground`; rows `focus-visible:ring-2 ring-inset ring-brand`.
- No shadows (every `--shadow-*` token is `none`), no blur, no gradients, no `style={{…}}` for anything a class can express (mask-image on scrollers is the one sanctioned inline style).

## 3. Type — five sizes, two weights
- `text-xs` meta/ages/counts/badges · `text-sm` secondary body, meta lines, chips, controls · `text-base` row titles, detail body, inputs · `text-xl` section headings, detail stat · `text-2xl` page title. Nothing else.
- **Heading scale — components own the size.** Every `<h1>` is `<PageTitle>` (28px), section headings `<SectionTitle>` (20px), sub-headings `<SubTitle>` (16px) — `src/components/ui/heading.tsx`, semibold/snug/balanced; a call site passes spacing only. A raw h2–h6 may take `text-xs|sm|base|xl` and nothing else. Long-form copy (About, legal, research, SEO hubs) is `<Prose>` (`src/components/ui/prose.tsx`), never a hand-rolled `prose` class.
- Weight: `font-semibold` for titles, counts, primary actions; default weight everywhere else (all other weights alias to 400/600 anyway — do not write `font-medium|bold`).
- Leading: `leading-snug` titles · `leading-relaxed` long body · `leading-none` single-line controls. Numbers `tabular-nums`. Ages/ids/stats `mono-data`.
- Never `text-[…]`, `leading-[…]`, `tracking-*`, `uppercase` outside `mono-data` labels.

## 4. Row anatomy (every list: jobs, applications, history, saved searches, résumé sections, settings groups)
`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-[var(--list-inset)] pt-4` · inner `border-b border-border pb-4` (divider inset past the leading tile) · title `text-base font-semibold leading-snug line-clamp-2` (read/secondary → `text-muted-foreground`) · lines 2–3 `mt-1 text-sm text-muted-foreground` (strong fact → `font-semibold text-foreground`) · right rail `mono-data text-xs leading-none text-muted-foreground` · hover/selected `bg-muted`. Horizontal padding on rows, list headers and toolbars is ALWAYS `px-[var(--list-inset)]` — never a literal `px-4`/`px-6`.

## 5. Controls
- **Control scale — the only heights.** `ctl-sm` 24px (segment, inline clear), `ctl-md` 32px (default button, chip, toolbar, header CTAs, tabs), `ctl-lg` 44px (input, select, form/search button — the whole search row). Tokens `--control-h-sm|md|lg` in globals.css; primitives pick a step through `size`, a call site never writes `h-*`/`min-h-*`/`py-*` on a control. Controls in one row share one step. The 44px touch target is an invisible coarse-pointer hit area (`--hit-min`), never a taller visual. Gate: `tests/unit/control-scale.test.ts`; exemption = on-line `control-scale-allow: <reason>`.
- Primary button: Button primitive default variant, `rounded-ctl px-6 text-xs font-semibold` (see `page.tsx` Search button). Secondary: `border border-border bg-card`. Ghost: no border, `hover:bg-muted`. Height from the control scale above.
- Chip: `chipVariants` (`ctl-md rounded-pill border border-border bg-background px-3 text-sm tabular-nums`), active `border-foreground`; count badge as in `chip.tsx`.
- Segment/tab: `ToolbarSegment` recipe — `ctl-sm rounded-ctl px-3 text-sm font-semibold leading-none`, pressed = `underline underline-offset-2` (no fill).
- Input/select/textarea: `rounded-ctl border border-border bg-card ctl-lg px-3 text-base`, focus `border-foreground`; clear buttons `ctl-sm ctl-square rounded-ctl bg-muted`.
- **Wrap row.** A row of controls that may wrap is `.wrap-row` (globals.css), not `flex flex-wrap`: its items are inline boxes under `text-wrap: balance`, so the last control never strands on a line of its own. Gap via `[--wrap-gap-x:…]`/`[--wrap-gap-y:…]`; space the row with padding (its block margin is the primitive's).
- Links inside copy: `text-foreground underline-offset-2 hover:underline`.

## 6. Panels, headers, empty, loading
- **Page container — one width, one gutter.** Every page body is `<PageContainer>` (`src/components/layout/PageContainer.tsx`) or a `.shell-row` — the TopBar's own geometry (72rem → 80rem at xl; 16/32/40px gutter), so a page's left edge is the logo's. `measure="reading"` narrows the content to 48rem on that same left edge; never centre a narrow column with `mx-auto max-w-* px-*`.
- List header line: `flex justify-between gap-3 px-[var(--list-inset)] py-2 text-sm text-muted-foreground`, count `font-semibold text-foreground tabular-nums`.
- Empty state: left-aligned, `py-8`, `text-sm text-foreground`, exactly one Next action (conveyor rule: nudge the next station, never a tangent).
- Loading: `skeleton-bar` bars shaped like the row anatomy; status line `pt-8 text-sm text-muted-foreground` left-aligned; spinner `animate-spin rounded-pill border-2 border-brand`.
- "Nothing here / gone" panels: `rounded-panel border border-dashed border-border bg-card px-6 py-16`.

## 7. Icons, spacing, colour, mobile
- Phosphor only, `size={16}` default; 20 in the tab bar; 24 only in a hero. Button slot `[&_svg]:size-4`.
- 4px grid; sibling gaps `gap-2/3/4`; never per-element margins where a `gap` works.
- Colour only via tokens: `brand`, `live`, `warn`, `danger-text`, `st-*` (tracker stages), `verdict-*`. No hex/rgb in TSX.
- Phone: 16px inset via `--list-inset`; tab bar `--mobile-tabbar-h`; sheets bottom-anchored with `rounded-panel` top corners; nothing wider than the viewport (layout-audit classes A–E clean at 390 and 1440).

## 8. Enforcement
`tests/unit/design-language.test.ts` + `scripts/design/banned-classes.cjs` keep banning arbitrary values. A per-surface ratchet (`design-token-baseline.json`) pins the count of off-token classes per surface (`rounded-none`, size-named radii, `text-[`, `h-[`, `w-[`, `p-[`, hex, `shadow-`, `style={{`); a count may only go down, and a PR that lowers it must lower the baseline too. `tests/unit/page-scale.test.ts` (`scripts/design/page-scale.cjs`) fails a hand-rolled page container, an h1/heading component that writes its own size, an off-scale h2–h6, and a bare `prose`; exemption = `page-scale-allow: <reason>` on the line or just above it. Journeys J-NAV-35–37 (`page-scale.spec.ts`) check the rendered result: no stranded control on a wrapping row, the page column on the logo edge, every h1 at 28px.

**Linux headless Chromium PNG captures:** use `linuxChromiumVisualQaLaunchOptions()` from `scripts/design/linux-chromium-visual-qa.cjs` (see `docs/design/DESIGN-LANGUAGE.md` § Visual QA capture fidelity). Default hinting splits labels in screenshots; `--font-render-hinting=none` fixes capture only — not a CSS change. Headed Xvfb does not fix it.

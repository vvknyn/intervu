# GROUP D-shared — marketing components shared by /connect and /openclaw (Fable spec, Sep 3 ~06:20 EDT)
Scope = exactly three files: `src/components/marketing/CopyCommand.tsx`, `src/components/marketing/PlatformInstallPanel.tsx`, `src/components/marketing/OpenclawWaitlistForm.tsx`. Nothing else (badge.tsx, globals.css, connect-client.tsx, openclaw/page.tsx are done/owned elsewhere). Tokens are already right at HEAD: `text-live` = #0E9F4E, `text-warn` = #B45309, `text-brand` = Klein #002FA7, `bg-muted` = layer #F4F4F4, `border-border` = hairline #E0E0E0, `text-muted-foreground` = #525252. Primitives to reuse: `Button` (default = filled Klein; `variant="ghost"` = Klein text, no border; `size="sm"` = h-8) and `Input` (field-01: layer bg, 1px bottom edge, 2px Klein focus) from `src/components/ui/`. Reference anatomy: `../canvas2/src/detail.html` (fields, ghost words) and `../canvas2/RULEBOOK.md` v2 clauses 1–9.

## CopyCommand.tsx (today: `border-2 border-foreground` box, 12px code, `border-l-2` Copy segment with ring-2)
- Container: `bg-muted` layer, NO border, px-4 py-3, 0 radius. Optional label above the code: 12/16 600 `text-muted-foreground` sentence case ("MCP endpoint", "Mac terminal command").
- Command text: mono 14/20 `text-foreground`, one line, `overflow-x-auto` (never wrap), user-select all.
- Copy control: `Button variant="ghost" size="sm"` with the word "Copy" (after success "Copied" for 1.5 s, then back) — Klein text, no icon, no border, no ring; sits at the right of the row (flex, items-center, gap-3). Keep the existing clipboard logic and aria-live/announcement if present.
- Focus: rely on the Button primitive's 2px Klein focus ring; delete the hand-rolled ring classes.

## PlatformInstallPanel.tsx (today: verdict Badge pills, Klein-bordered macOS block, lowercase "available today"/"waitlist", black "Notify me", plain email field)
- Each platform block: `bg-muted` layer, NO border (also no Klein border on the "recommended" one — the ordering/heading carries emphasis), p-4, blocks stacked with gap-3.
- Block header row: platform name 14/20 600 `text-foreground` ("macOS", "Windows · Linux") + one-line description 14/20 `text-muted-foreground`; status as a WORD at the right end of the header row, 12/16 600, sentence case: "Available today" in `text-live`, "Waitlist" in `text-warn`. No `Badge`, no pill, no dot, no icon. Remove the Badge import if unused after.
- macOS block body: the `CopyCommand` (above) + the footnote 12/16 `text-muted-foreground` ("Runs on your machine. Stops before submit. Free to self-host.").
- Windows · Linux block body: the `OpenclawWaitlistForm` (below).

## OpenclawWaitlistForm.tsx (today: `bg-foreground` black submit, `min-h-11`, `text-xs font-semibold`, hand-styled input)
- Input: the `Input` primitive (field-01), h-10, placeholder "you@company.com", `aria-label` kept, no extra border/bg classes.
- Submit: `Button` default (filled Klein), h-10 (`size` default or `className="h-10"` if the primitive's default is 40px already — check), label sentence case ("Notify me" / "Joining…" kept), 14/20 600 white from the primitive; delete the bg-foreground/text-xs/dark: overrides. This is the ONE filled control in the right-hand region of /connect and in the /openclaw form region.
- Layout: input + button on one row from `sm:` up (input flex-1), stacked below; gap-2. Success/error outcome text: 14/20, `text-live` for success, `text-warn`… no — errors use `text-destructive` (red-60) 14/20; success 14/20 `text-foreground`. No icons. TurnstileWidget untouched.

## Deletions allowed
Unused imports (Badge, icons), dead class strings. Nothing else.

## Verify (≤25 lines back)
1. `npx tsc --noEmit` exit 0; `npm run test:design` → "# pass 22 # fail 0".
2. Route probe: `cd $SP && NODE_PATH=/Users/vivek/Antigravity/Code/interview-os/node_modules node route-probe.cjs routes.json $SP/groupDS /connect --base=http://localhost:3000` and the same with `/openclaw` (the substring arg filters routes; both viewports run) → before→after table from `$SP/groupDS/ledger.json` (before: /connect 2/0 at HEAD, /openclaw 0/0).
3. View `$SP/groupDS/shots/ledger/connect-desktop.png` and `openclaw-desktop.png` yourself and confirm: no bordered boxes in the right card, status words not pills, one filled Klein "Notify me", ghost "Copy" words.
4. Do NOT commit, do NOT run the sweep script, do not touch any other file.

# Soft Signal · Desktop system (1280+)

Viewport target: **1440×900** framed at content max **1280**. Gutter **32px**. 8pt grid.

## Tokens
Same as mobile: bg `#F4F6F8`, surface `#FFF`, ink `#12151A`, brand `#0D6E56`, Plus Jakarta + JetBrains Mono.
```
--gutter 32 · --max 1280 · --detail 400 · --topbar 56 · --search-h 44 · --fit 380
```

## Chrome
- **Topbar:** wordmark + BETA · nav links Find jobs / Tracker / Resume / Interview prep · night + Log in (or avatar)
- **No bottom tabs.** Trends / Stories / Hot / Settings via avatar menu or secondary links.
- Shared left column: wordmark = search What = list cards. Shared right: Search btn = detail pane.

## Patterns
- **Search:** `What | Where | Search` one row (Where ~280–320px)
- **Filters:** expandable panel under search (3-col grid). Elite under Boards only — never a marketing chip
- **SERP:** list `1fr` + sticky detail `400`
- **Fit:** right drawer 380 over detail (or replaces detail)
- **Tracker:** 4-col kanban
- **Resume / Prep / Company / Settings:** single-column content max 960–1100 inside shell

## Alignment
1. Wordmark left = What field left = Filters left = Results left
2. Search right = Log in right = detail right
3. list-head + cards share same padding/grid for Apply column

## Screens
01-find-empty · 02-find-serp · 03-filters · 04-fit-drawer · 05-auth · 06-tracker · 07-pursuit · 08-resume · 09-prep-landing · 10-prep-session · 11-company · 12-hot · 13-tailor · 14-stories · 15-trends · 16-settings · 17-add-pursuit
00-index · 99-gallery · _system.css

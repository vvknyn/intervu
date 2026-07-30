# Soft Signal UI Implementation Plan

> **For agentic workers:** soft-signal desktop/mobile mocks in `docs/design/soft-signal-*` are the pixel source of truth. EDITORIAL-PASS is superseded for product chrome.

**Goal:** Ship Soft Signal visual system across app — Find jobs first (desktop split + mobile sheets), then cascade chrome to other pages.

**Branch:** `feat/soft-signal-ui`

## Files
| File | Change |
|------|--------|
| `src/app/soft-signal.css` | NEW tokens, card/sheet/search utilities |
| `src/app/globals.css` | Point theme to Soft Signal; keep verdict channels |
| `src/app/layout.tsx` | Plus Jakarta + JetBrains Mono |
| `src/components/layout/TopBar.tsx` | Soft Signal nav; restore mobile tab bar |
| `src/app/page.tsx` | What\|Where\|Search; Elite in filters; soft cards; desktop sticky detail |
| `src/components/jobs/SerpFilters.tsx` | Soft filter panel + Boards group |
| `src/components/jobs/BoardChips.tsx` | Deprecate top chip / fold into filters |
| `src/components/jobs/JobDetail.tsx` | Soft Signal detail chrome |
| `src/components/jobs/FitDrawer.tsx` | Soft Signal drawer (reuse brand green) |

## Tasks
1. Tokens + fonts + TopBar
2. SERP search row + filters (location + Boards/Elite)
3. JobCard soft-signal + desktop detail pane / mobile sheet
4. Cascade pages (tracker/resume/prep surfaces use new tokens)
5. Verify build + browser desktop 1280 + mobile 390

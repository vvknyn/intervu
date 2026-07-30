# Soft Signal · Mobile system (390×844)

Device: iPhone 14/15 logical **390×844**. Safe area: top 47 (status) / bottom 34 (home). Content gutter **16px**. 8pt grid.

## Tokens
```
--bg #F4F6F8 · --surface #FFF · --ink #12151A · --muted #5C6570 · --faint #8B939E
--line #E2E6EB · --brand #0D6E56 · --brand-soft #E6F4EF · --live #129B6E
--gutter 16 · --topbar 52 · --tabbar 56+safe · --search-h 44 · --r-lg 14
Font: Plus Jakarta Sans + JetBrains Mono
```

## Chrome
- **Topbar:** wordmark left · avatar right. No desktop nav links.
- **Tab bar (4):** Find · Tracker · Resume · Prep. Active = brand ink + 2px top hairline. Trends/Stories/Settings via avatar sheet.
- **Gutter:** every screen content `padding-inline: 16`. Cards full-bleed within content (no side margin inconsistency).

## Patterns
- **Search:** stacked — What (full) → Where (full) → Search (full, 44h). Not side-by-side.
- **Filters:** bottom sheet ~92% height, handle 36×4, sections stacked (not 3-col). Elite under Boards.
- **Job detail:** bottom sheet ~92%, sticky action row (Go after + Tailor).
- **Fit:** bottom sheet (not side drawer).
- **Cards:** logo 40 · body 1fr · no Apply column on list (tap opens sheet). Age in meta row. Live + fit + intel footer.

## Alignment rules
1. Wordmark left = search left = card left = sheet title left (16px).
2. Tab icons centered in equal 4 columns.
3. Sheet handle centered; padding 16 matches page gutter.
4. All vertical rhythm multiples of 8.

## Screen files (build order)
Core: 01-find-empty · 02-find-serp · 03-filters-sheet · 04-job-detail · 05-fit-sheet · 06-auth · 07-tracker · 08-pursuit · 09-resume · 10-prep-landing · 11-prep-session · 12-company
Secondary: 13-hot · 14-tailor · 15-stories · 16-trends · 17-settings · 18-add-pursuit
Hub: 00-index.html · 99-gallery.html (all phones)
Shared: `_system.css`

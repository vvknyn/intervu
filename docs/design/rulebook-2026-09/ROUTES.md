# Route ledger — rulebook violations per route (desktop 1440 / mobile 390)

Generated 2026-09-03T13:26:37.094Z from the computed-style probe (`impl/route-probe.cjs`). Baseline = origin/main a662014. Violations = elements off the type scale, with depth (shadow/translucency/radius), off-grid spacing, or off-scale svg sizes.

**36 routes · 30 PASS · 0 FAIL · 4 EXEMPT · 2 not rendered.**

| route | http | before d/m | after d/m | status | remaining | screenshots | note |
|---|---|---|---|---|---|---|---|
| / | 200 | 344/100 | 0/0 | PASS |  | root-desktop.png, root-mobile.png | rendered as /jobs |
| /about | 200 | 73/47 | 0/0 | PASS |  | about-desktop.png, about-mobile.png |  |
| /account | 200 | 49/49 | 0/0 | PASS |  | account-desktop.png, account-mobile.png | rendered as /login?next=%2Fsettings%3Ftab%3Daccount |
| /admin | 200 | 49/49 | 0/0 | PASS |  | admin-desktop.png, admin-mobile.png | rendered as /login?next=/admin |
| /co/[slug] | 200 | 117/77 | 0/0 | PASS |  | co-slug-desktop.png, co-slug-mobile.png |  |
| /companies/[slug] | 200 | 56/61 | 0/0 | PASS |  | companies-slug-desktop.png, companies-slug-mobile.png |  |
| /companies/hiring | 200 | 344/100 | 0/0 | PASS |  | companies-hiring-desktop.png, companies-hiring-mobile.png | rendered as /jobs |
| /connect | 200 | 169/105 | 0/0 | PASS |  | connect-desktop.png, connect-mobile.png |  |
| /connect/help | 200 | 66/64 | 0/0 | PASS |  | connect-help-desktop.png, connect-help-mobile.png |  |
| /contact | 200 | 78/60 | 0/0 | PASS |  | contact-desktop.png, contact-mobile.png |  |
| /jobs | 200 | 390/161 | 0/0 | PASS |  | jobs-desktop.png, jobs-mobile.png |  |
| /jobs/[slug] | 200 | 57/147 | 0/0 | PASS |  | jobs-slug-desktop.png, jobs-slug-mobile.png |  |
| /login | 200 | 49/49 | 0/0 | PASS |  | login-desktop.png, login-mobile.png |  |
| /mock/auth-gate | 200 | 40/40 | 14/14 | EXEMPT | translucent rgba(255, 255, 255, 0.043)×1 rgba(255, 255, 255, 0.07)×1, color rgb(139, 145, 154)×3 rgb(250, 250, 250)×2 rgb(236, 236, 236)×2 rgb(196, 201, 209)×1 rgb(18, 21, 26)×1, bg rgb(18, 21, 26)×1 rgb(236, 236, 236)×1, svg 96px×1 | mock-auth-gate-desktop.png, mock-auth-gate-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/completeness | 200 | 199/150 | 64/52 | EXEMPT | weight 550×1, shadow file:text-foreground selection:bg-brand ×2, radius 3.35544e+07px×7 14px×4, color rgb(163, 163, 163)×19 rgb(250, 250, 250)×6 rgb(236, 236, 236)×2 rgb(18, 21, 26)×1 rgb(139, 145, 154)×1, bg rgb(0, 0, 0)×3 rgb(240, 253, 244)×3 rgb(18, 21, 26)×1 rgb(236, 236, 236)×1, svg 40px×1 | mock-completeness-desktop.png, mock-completeness-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/email-nudge | 200 | 62/42 | 0/0 | PASS |  | mock-email-nudge-desktop.png, mock-email-nudge-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/lockup | 200 | 31/31 | 2/2 | EXEMPT | svg 28px×2 | mock-lockup-desktop.png, mock-lockup-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/oauth-consent | 200 | 10/10 | 0/0 | PASS |  | mock-oauth-consent-desktop.png, mock-oauth-consent-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/search-dock | 200 | 163/87 | 0/0 | PASS |  | mock-search-dock-desktop.png, mock-search-dock-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/search-emphasis | 200 | 76/47 | 0/0 | PASS |  | mock-search-emphasis-desktop.png, mock-search-emphasis-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /mock/surface | 200 | 130/74 | 4/2 | EXEMPT | bg oklab(0.378488 -0.0230317 -0.19404 / 0.05)×1 oklab(0.378488 -0.0230317 -0.19404 / 0.06)×1 | mock-surface-desktop.png, mock-surface-mobile.png | dev-only design fixture; gated off production by src/app/mock/layout.tsx (decision 19); auth-gate and completeness are deliberate off-rulebook comparison pages |
| /oauth/authorize | 200 | 10/10 | 0/0 | PASS |  | oauth-authorize-desktop.png, oauth-authorize-mobile.png |  |
| /openclaw | 200 | 67/66 | 0/0 | PASS |  | openclaw-desktop.png, openclaw-mobile.png |  |
| /privacy | 200 | 47/45 | 0/0 | PASS |  | privacy-desktop.png, privacy-mobile.png |  |
| /research/ghost-jobs | 200 | 93/44 | 0/0 | PASS |  | research-ghost-jobs-desktop.png, research-ghost-jobs-mobile.png |  |
| /reset-password | 200 | 24/29 | 0/0 | PASS |  | reset-password-desktop.png, reset-password-mobile.png |  |
| /resume | 200 | 35/40 | 0/0 | PASS |  | resume-desktop.png, resume-mobile.png |  |
| /settings | 200 | 49/49 | 0/0 | PASS |  | settings-desktop.png, settings-mobile.png | rendered as /login?next=%2Fsettings |
| /stories | 200 | 33/38 | 0/0 | PASS |  | stories-desktop.png, stories-mobile.png |  |
| /terms | 200 | 52/46 | 0/0 | PASS |  | terms-desktop.png, terms-mobile.png |  |
| /trends | 200 | 284/67 | 0/0 | PASS |  | trends-desktop.png, trends-mobile.png |  |
| /watch/[id] | — | — | — | NOT RENDERED |  |  | sign-in gated, no public sample id — verified by code read + tsc (decision 23) |
| /watch/anywhere | 200 | 35/40 | 0/0 | PASS |  | watch-anywhere-desktop.png, watch-anywhere-mobile.png |  |
| /yours | 200 | 30/37 | 0/0 | PASS |  | yours-desktop.png, yours-mobile.png |  |
| /yours/[id] | — | — | — | NOT RENDERED |  |  | sign-in gated per-user record, no public id — verified by code read + primitives (Group E, decision 29) |
| /yours/history | 200 | 23/30 | 0/0 | PASS |  | yours-history-desktop.png, yours-history-mobile.png |  |

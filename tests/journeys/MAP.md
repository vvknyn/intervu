# Journey map

A readable map of the journeys in [CATALOG.md](CATALOG.md), grouped by where a visitor is on their way through Velai. For a product person it says what each stage is and what is broken; for an engineer it says which catalog rows guard each stage and how many have a spec. CATALOG.md stays the source of truth: IDs, wording and status live there, and the stage table below is generated from it.

## Where job lists appear

**The rule the product is moving to:** a list of jobs appears only when there is a reason for it: the visitor's résumé, their own search or filters, or the specific job, company or career page they came for. Bare /jobs becomes a front door with no rows (upload a résumé, sign in, or search). Typed search stays open to guests: the first 90 rows, then a sign-in card. A guest with a résumé sees their top 3 matches, then a sign-in card. Company and job pages stay public.

**Live on staging:** guest search with the sign-in card after 90 rows (J-JOBS-06), a guest's top 3 matches and then the sign-in card (J-JOBS-34), and public company and job pages. **In flight:** the For you gate PR #711 (For you needs an account: a signed-out visitor gets one sign-in card instead of job packs, and a guest's résumé ranks the Search board) and the search relevance PR (results put the best match first, then newer roles). **Not live:** the front door; bare /jobs still lists the newest roles in the visitor's country (J-JOBS-01).

Today (staging): what a visitor sees arriving on /jobs. Red: a job list with no reason behind it; green: a list with a reason; blue: what #711 changes; tan: a sign-in card.

```mermaid
flowchart TD
  A([Opens velai.app or /jobs]):::entry --> B{Signed in?}
  B -- no --> C{Résumé saved<br/>in this browser?}
  C -- no --> D["Search home, nothing typed<br/>newest roles in your country<br/>(ranked by date only)"]:::bad
  C -- yes --> E["For you: pack tiles and pack rows<br/>#711 sends guests to Search,<br/>which shows the same newest roles"]:::bad
  D -- types a search<br/>or picks filters --> F["Results for that search<br/>guests: first 90"]:::ok
  F -- scrolls past 90 --> G1["Sign-in card:<br/>See the other N roles"]:::gate
  D -- uploads résumé --> H["Review résumé, then For you packs<br/>#711: Search ranked by résumé"]:::fix
  H --> I["Top 3 matches"]:::ok --> G2["Sign-in card:<br/>See all N matches"]:::gate
  B -- yes --> J{Résumé on file?}
  J -- no --> K["Résumé card:<br/>Upload or Skip"]:::ok
  K -- Skip --> L["Search home, nothing typed<br/>newest roles in your country"]:::bad
  K -- Upload --> M
  J -- yes --> M["For you: job packs<br/>ranked by résumé"]:::ok
  M -- opens a pack --> P["Pack rows"]:::ok
  M -- Advanced search --> N["Search home, nothing typed<br/>newest roles, résumé not used"]:::bad
  L -- types a search --> F2["Results, no limit"]:::ok
  N -- types a search --> F2
  classDef bad fill:#f8d4cf,stroke:#b3261e,color:#3d0c07
  classDef ok fill:#d9efe0,stroke:#1f7a44,color:#0b2e19
  classDef fix fill:#d6e4fb,stroke:#2757b6,color:#0b1f4d
  classDef gate fill:#efe6d2,stroke:#8a6a1f,color:#2e2308
  classDef entry fill:#e4e6ec,stroke:#5a6070,color:#17191e
  classDef q fill:#f1f2f5,stroke:#5a6070,color:#17191e
  class B,C,J q
```

Proposed: the same arrival under the rule. Orange: new or changed; green: as today; tan: a sign-in card.

```mermaid
flowchart TD
  A([Opens velai.app or /jobs]):::entry --> B{Signed in?}
  B -- no --> C{Résumé saved<br/>in this browser?}
  C -- no --> D["Front door, no job rows<br/>Upload résumé · Sign in · Search jobs<br/>live count: roles posted this week"]:::new
  C -- yes --> I
  D -- uploads résumé --> R["Review résumé<br/>(stays on this device)"]:::same --> I["Their top 3 matches<br/>best fit first, newest first among equals"]:::new
  I --> G2["Sign-in card:<br/>See all N matches"]:::gate
  D -- Search jobs<br/>(advanced search) --> F["Results for their search<br/>best match, then newest · first 90"]:::new
  F -- scrolls past 90 --> G1["Sign-in card:<br/>See the other N roles"]:::gate
  B -- yes --> J{Résumé on file?}
  J -- no --> K["Résumé card:<br/>Upload or Skip"]:::same
  K -- Skip --> L["Search, no rows until they search<br/>Add your résumé to see matches"]:::new
  K -- Upload --> M
  J -- yes --> M["For you: job packs<br/>best fit, newest first"]:::same
  M -- Advanced search --> N["Search opens on<br/>new roles that fit you"]:::new
  L -- searches --> F2["Results, no limit<br/>best match, then newest"]:::new
  N -- searches --> F2
  G1 -- signs up --> F2
  G2 -- signs up --> M
  classDef gate fill:#efe6d2,stroke:#8a6a1f,color:#2e2308
  classDef entry fill:#e4e6ec,stroke:#5a6070,color:#17191e
  classDef new fill:#fbe8c8,stroke:#a15c00,color:#2f1c00
  classDef same fill:#d9efe0,stroke:#1f7a44,color:#0b2e19
  classDef q fill:#f1f2f5,stroke:#5a6070,color:#17191e
  class B,C,J q
```

## Stages

Each catalog row belongs to one stage. **Covered**: a tagged spec runs it. **Known-bug**: status `known-bug` (a spec wrapped in `test.fail()`). **Bug noted**: an uncovered row whose text says what should happen and ends "(known bug: …)"; it needs a spec before it can take the `known-bug` status. Numbers skipped in a range are rows deleted or merged, or rows other open PRs are adding.

<!-- stage-table:start (generated by node scripts/journey-map-counts.mjs --write) -->
| Stage | Catalog rows | Rows | Covered | Uncovered | Known-bug | Bug noted |
|-------|--------------|-----:|--------:|----------:|----------:|----------:|
| [Landing on /jobs with no search](#landing-on-jobs-with-no-search) | JOBS 01, 03, 21, 24–25, 29–30, 65–66 · SRCH 01–02, 18 · MOB 01, 14, 16–18 · ALERTS 21–23 · NAV 01, 06, 21 | 23 | 5 | 18 | 0 | 0 |
| [Search, filters and results](#search-filters-and-results) | JOBS 04–08, 14–18, 26, 28, 67–74 · SRCH 03–17, 19–21, 30–32 · FILT 01–24 · MOB 02, 11–13, 21 | 70 | 6 | 64 | 0 | 0 |
| [Résumé upload and top matches](#résumé-upload-and-top-matches) | JOBS 34–36, 76–78 · AUTH 31–33 · RESUME 28–29 · MODAL 01 | 12 | 6 | 6 | 0 | 0 |
| [For you: job packs](#for-you-job-packs) | JOBS 19–20, 27, 31, 37–42, 46, 52 · NAV 30–32 | 15 | 12 | 3 | 0 | 0 |
| [Job detail: pane, sheet, page](#job-detail-pane-sheet-page) | JOBS 09–13, 23, 75 · MOB 03, 09–10 · DETAIL 01–33 · ERR 07–08 | 45 | 10 | 35 | 0 | 0 |
| [Apply](#apply) | APPLY 01–25, 29–33 | 30 | 0 | 30 | 0 | 1 |
| [Save and tracker](#save-and-tracker) | JOBS 32–33 · TRACKER 01–47, 61–66 · NAV 10 · MODAL 04 | 57 | 3 | 54 | 0 | 0 |
| [Saved searches, alerts, follows](#saved-searches-alerts-follows) | JOBS 22 · ALERTS 01–16, 18–20, 26–27, 29, 31–45 | 38 | 0 | 38 | 0 | 2 |
| [Company pages](#company-pages) | COMPANY 01–02, 04–31, 43–46 | 34 | 1 | 33 | 0 | 1 |
| [Sign in and create account](#sign-in-and-create-account) | JOBS 79 · AUTH 01–30, 34–36, 39–44, 46–50 · NAV 03–05, 17–19 | 51 | 5 | 46 | 0 | 0 |
| [Résumé page and Customize](#résumé-page-and-customize) | RESUME 01–23, 25–27 · MODAL 03, 06 | 28 | 2 | 26 | 0 | 0 |
| [Settings and account](#settings-and-account) | SETTINGS 01–11, 13–20, 22–27, 31–33 · NAV 11–13, 20 | 32 | 0 | 32 | 0 | 1 |
| [AI agents: Connect, OAuth, MCP](#ai-agents-connect-oauth-mcp) | COMPANY 32–34 · CONNECT 01–27 · OAUTH 01–21 | 51 | 0 | 51 | 0 | 4 |
| [Career hubs, comparison pages, content, SEO](#career-hubs-comparison-pages-content-seo) | CONTENT 01–07, 09–26 · SEO 01–09 | 34 | 1 | 33 | 0 | 0 |
| [Pricing and founding seat](#pricing-and-founding-seat) | PRICING 01–10 | 10 | 5 | 5 | 0 | 0 |
| [Header, menus, errors, layout](#header-menus-errors-layout) | MOB 04–08, 19 · NAV 07–09, 14, 22–29, 33–39 · ERR 01–06, 10–15, 17–18 · ADMIN 01–04 · MODAL 02, 05 | 45 | 11 | 34 | 0 | 0 |
| **All stages** | | **575** | **67** | **508** | **0** | **9** |
<!-- stage-table:end -->

### Landing on /jobs with no search

What someone sees when they open velai.app or /jobs without typing anything. Today that is the search box over the newest roles in their country, with the country chip, a return card for a returning guest and, on a phone, the Search button; under the new rule it becomes the front door with no rows.

### Search, filters and results

Typing a search or picking filters, and everything on the results list: suggestions, location, filters and their chips, sort, loading more up to a guest's 90 rows, and the empty, stale and error states.

### Résumé upload and top matches

Adding a résumé from /jobs, checking what was read from it, and seeing roles ranked against it: a guest sees their top 3, then a sign-in card. Also the board's prompts to add one ("Rank with my résumé", the résumé moment) and the résumé step right after sign-up.

### For you: job packs

The job packs a visitor with a résumé gets on For you: pack tiles and their counts, opening a pack and coming back, the For you / Search switch, and what a pack shows when a read fails. The For you gate PR #711 makes this signed-in only.

### Job detail: pane, sheet, page

Opening one job: the side pane on a wide screen, the bottom sheet on a phone, and the public /jobs/<slug> page that shared links open, with save, share and report.

### Apply

Pressing Apply. A guest is asked to sign in first and the apply picks up afterwards; a signed-in user goes to the employer's site and, on coming back, is asked "Did you apply?" so the tracker can record it.

### Save and tracker

Saving roles and tracking applications on /yours (the lanes, the detail sheet, the full pursuit page) and History, for a guest in this browser and for an account, including the sync at first sign-in.

### Saved searches, alerts, follows

Hearing about new roles: saved searches, email alerts for a search, following a company, the follow-alerts bell, the confirm links in those emails, and unsubscribe.

### Company pages

Public company pages (/co/<company>) and name-keyed /companies pages: the company's open roles and role search, Follow, the record kept behind sign-in, and what following unlocks.

### Sign in and create account

/login and the sign-in dialog: Google, passkey and email-code handoff, form errors, password reset, where the visitor lands afterwards (`next=`), and the prompts that ask a guest to sign in.

### Résumé page and Customize

The /resume page for a guest (a résumé kept in this browser) and for an account (upload, replace, delete, edit, download), plus Customize résumé on a role.

### Settings and account

/settings: the Résumé, Preferences and Account tabs, the account email and weekly digest, on-device AI, signing out and deleting the account, and the account menu that leads there.

### AI agents: Connect, OAuth, MCP

Connecting an AI assistant: the /connect setup for Claude, ChatGPT, Gemini and Cursor, the OAuth consent screen, the MCP endpoint agents call, and the /watch pages (catalogued as J-COMPANY-32 to 34).

### Career hubs, comparison pages, content, SEO

The pages around the product: career hubs, the Indeed, LinkedIn and Eluta alternative pages, trends and research, privacy, terms, contact and stories, plus what crawlers read (robots, sitemap, page metadata).

### Pricing and founding seat

The pricing page, reserving or buying a founding seat, and what a signed-in visitor sees there.

### Header, menus, errors, layout

The frame around every page: the header, the phone tab bar, the footer, menus, control and type sizes, the 404 and error pages, and who can open /admin.

## Known problems

Line numbers are the audit's, taken at staging 8baeaee; a few may have moved since.

**Broken rows.** The row says what should happen and the code does something else. Each is still `uncovered`.

- **J-JOBS-11**: closing the detail pane after arriving on a `?job=` link leaves /jobs (or opens a blank page) instead of clearing `?job=`, because the pane's × calls `router.back()` with nothing in the app behind it. `src/app/jobs/JobsContent.tsx:6551`. Row wording unchanged: another open PR touches it.
- **J-APPLY-01**: a guest's Apply opens a dialog titled "Sign in", never "Sign in to apply", because `gate()` opens it without setting the reason. `src/components/auth/use-auth-gate.ts:80-103`, `src/components/jobs/PublicJobDetail.tsx:318`.
- **J-COMPANY-18**: a verified guest's Unfollow lasts only until the next page load, because every company page load follows them again; a bare `?followed=1` link also shows Unfollow. `src/lib/follows/use-company-email-verified.ts:39-46`, `src/actions/email-follow.ts:37-41`.
- **J-ALERTS-09**: a signed-in user's toolbar "Get alerts" opens the guest email form, which renders with no signed-in check. `src/app/jobs/JobsContent.tsx:5497-5507, :6669`.
- **J-OAUTH-02**: from the consent screen's "Sign in to continue" card, only a Google or passkey sign-in, or an account with a résumé, gets back to consent; the rest land on /jobs?resume=gate. The row now describes the working path; the failing one is J-OAUTH-19. `src/lib/auth/post-auth-destination.ts:70-73, :82-83`.

**Rows added with a known bug.** New `uncovered` rows that describe what should happen and end "(known bug: …)".

- **J-APPLY-29**: after a guest closes the Apply sign-in dialog, a later search or sign-in reopens it or replays the apply, because `gate()` never stops listening for sign-in. `src/components/auth/use-auth-gate.ts:80`.
- **J-COMPANY-43**: a guest who confirmed a follow email is followed to every company page they open (same cause as J-COMPANY-18). `src/lib/follows/use-company-email-verified.ts:39-46`, `src/actions/email-follow.ts:37-41`.
- **J-ALERTS-42**: search-alert and follow confirm links land on /jobs with no confirmation or error; nothing reads `search_alert` or `followed=0`. `src/app/api/search-alerts/verify/route.ts:12,21-26`, `src/app/api/follow-email/verify/route.ts:22,31-40`.
- **J-ALERTS-44**: the bell's "View followed roles" opens the elite board (/jobs?board=elite), not roles at the companies you follow. `src/components/follows/FollowAlertsBell.tsx:172-177`.
- **J-SETTINGS-31**: confirming an added account email shows nothing on /settings; `?email_confirmed=1` is ignored. `src/app/api/account/email/verify/route.ts:24`.
- **J-CONNECT-24**: "Sign in to velai" on /connect promises a return to /connect, but a résumé-less password sign-in or any signup lands on /jobs?resume=gate. `src/app/connect/connect-client.tsx:173-178`, `src/lib/auth/post-auth-destination.ts:70-73`.
- **J-CONNECT-25**: signed in, the /connect steps start at "2." with no step 1. `src/app/connect/connect-client.tsx:185,195`.
- **J-OAUTH-19**: the agent approval is lost when a résumé-less user signs in with a password, or anyone signs up, from the consent screen's sign-in card. `src/lib/auth/post-auth-destination.ts:70-73, :82-83`.
- **J-OAUTH-20**: the consent screen says the agent cannot read your résumé, but the MCP server offers `get_resume` and `set_resume`. `src/components/oauth/ConsentCards.tsx:128-133`, `src/lib/agent/mcp-tool-specs.ts:281,310`.

Also already in the catalog as a defect: **J-FILT-08**, salary choices the filter offers ($75k+, $30k+, a custom minimum) are dropped from the URL, which knows only 50k, 100k, 150k and 200k. `src/components/jobs/FilterPanel.tsx:50`, `src/lib/jobs/url-state.ts:138-139`.

## Keeping this current

- Add or change the row in [CATALOG.md](CATALOG.md) first; the Contract there still applies (tag, Writes, status).
- Put the row in the right stage. Rows in APPLY, TRACKER, ALERTS, COMPANY, AUTH, RESUME, SETTINGS, CONNECT, OAUTH, CONTENT, SEO, PRICING, SRCH, FILT, DETAIL, ERR and ADMIN land in their area's stage on their own. A row in JOBS, MOB, NAV or MODAL, or one that belongs in another stage than its area's, needs its ID added to `STAGES` in `scripts/journey-map-counts.mjs`.
- Regenerate the stage table: `node scripts/journey-map-counts.mjs --write` (no dependencies). `--check` exits non-zero when the table is stale or a row has no stage.
- When a bug above is fixed, drop its "(known bug: …)" note from the row, give the row a spec, and delete its line here. When #711 or the search relevance PR lands, update the live and in-flight lines and the diagrams.

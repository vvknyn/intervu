# Intervu completeness backlog — no AI fluff

**Date:** 2026-08-05  
**Constraint:** All AI stays on Connect / MCP (user’s AI client). Do **not** ship in-app match scores, “why this fits,” Orion-style chat, resume tailoring UI, autofill, or interview-prep generators.  
**Goal:** Make the features we already claim feel finished — board, tracker, Connect, ghost signals, chrome.

Companion doc (competitive): `2026-08-05-jobright-vs-intervu-gap-report.md`  
This doc **supersedes that roadmap** for product work under the no-AI-fluff constraint.

---

## Product thesis (locked)

Intervu = **verified market + ghost screening + tracker + MCP handoff**.  
Completeness = every existing loop works end-to-end without lying, dead ends, or half-wired CTAs.  
Personalization and “intelligence” happen in the user’s AI via Connect — not in our UI chrome.

---

## Definition of done (per surface)

| Surface | Done means |
|---------|------------|
| **Jobs** | Search/filter/sort/detail feel trustworthy; counts and money/names are honest; Save/Apply/Mark applied have clear outcomes; Connect handoff from a job is one click. |
| **Tracker** | Guest and signed-in paths are coherent; stages/notes/remove work; board Save and tracker stay in sync; no orphan sheets. |
| **Connect** | Nav lands on `/connect`; pairing instructions accurate; MCP tools match what the UI promises; agent credentials manageable in Settings. |
| **Chrome** | Dark void consistent; no FOUC; no tabs to wrong routes; no advertised installers that 404. |

Out of scope for this backlog: Recommended-for-you feed, match %, skill gaps, cover letters, coaching, autofill extensions, email marketing systems (unless noted as optional P2 for *non-AI* alerts).

---

## P0 — Broken or lying surfaces (fix first)

These make the current product feel incomplete even before feature gaps.

| # | Work | Why | Evidence |
|---|------|-----|----------|
| 1 | **Fix Connect nav** — tab must go to `/connect`, not `/` | Users cannot find the AI surface from primary nav | `nav-tabs.tsx` |
| 2 | **Clarify Save CTA when logged out** — either guest-bookmark into `intervu.pursuits.guest` *or* label the button “Sign in to save” before click | “Save” → silent auth modal feels broken | Live QA + `handleGoAfter` auth gate |
| 3 | **Close Track-a-role sheet after successful save** | Sheet stays open; list updates behind it | Live QA on `/yours` |
| 4 | **Honest result counts** — show query-scoped total (or drop the misleading “N roles” that mirrors a global facet) | `13,395 roles` under a filtered PM+Remote search is confusing | Live QA |
| 5 | **Salary display hygiene** — fix unit/scale bugs (`USD 1560k–1800k`) | Undermines “verified market” trust | Limble listing |
| 6 | **Company display names** — stop showing ATS hostnames / internal codes as the company (`fnagroup.applicantpro.com`, `C0001 Acxiom…`, `NDIN-Adobe…`) | List looks scrape-raw, not productized | Live QA |
| 7 | **Kill or fulfill advertised dead ends** — `/install` curl with no route; `/companies/hiring` redirect; OpenClaw “install” if unshipped | Marketing promises that 404 | Inventory |
| 8 | **Mount or delete `AgentAccessSection`** — users who paired an agent need to see/revoke credentials in Settings | MCP story incomplete without credential management | Inventory |

---

## P1 — Finish the existing loops (no new AI)

### Jobs board

| # | Work | Notes |
|---|------|-------|
| 9 | **Job detail → Connect handoff with context** — “Pair your AI” / “Open in Connect” that deep-links or copies a prompt including this `job_id` / title / company | Not AI in our UI; strengthens MCP thesis without fluff |
| 10 | **Description formatting** — render scraped JD as readable sections (headings, lists), not a single wall behind “Show full description” | Non-AI presentation quality |
| 11 | **Sort discoverability** — sort exists (newest / relevance / salary_desc); ensure control is obvious on desktop + mobile | Completeness of shipped sort |
| 12 | **Empty / zero-result states** — clear “no roles match; clear X filter” with one-click chip clear | Board polish |
| 13 | **Dead posting tombstones** — confirm expired `job_id` paths stay clear from detail + tracker | Already partially built; verify end-to-end |
| 14 | **Follow alerts honesty** — if visit-scoped only, copy must say “since last visit,” not imply email | Avoid fake “alerts” |

### Tracker

| # | Work | Notes |
|---|------|-------|
| 15 | **Feed ↔ tracker coupling** — after Save (signed-in), detail shows Saved ✓ → `/yours/[id]`; Jobs chrome can show a simple count (“3 tracked”) without Liked/Applied AI theater | Sync, not match scores |
| 16 | **Guest → auth merge messaging** — after login, confirm guest pursuits/follows synced (toast or tracker banner) | Sync already exists; surface it |
| 17 | **Stage + note completeness** — verify interview date, note save, remove, download resume on both sheet and `/yours/[id]` | Inventory says real; QA only spot-checked guest sheet |
| 18 | **Apply-cap feedback** — when daily 20/UTC cap hits, show a clear message (not a silent fail) | Cap exists in code |
| 19 | **Mark as applied from detail** — same auth rules as Save; outcome visible in tracker stage chips | Close the loop |

### Connect / MCP

| # | Work | Notes |
|---|------|-------|
| 20 | **Align UI promises with 11 tools** — `/connect` sample prompts should only claim tools that exist (`search_jobs`, `save_job`, `mark_applied`, resume variants, preferences, etc.) | No “tailor my resume” marketing if that’s client-side only and unclear |
| 21 | **Per-client accuracy pass** — Claude / ChatGPT / OpenClaw / Gemini / Cursor tabs: each instruction still correct in 2026 | Drift kills pairing |
| 22 | **How-it-works films** — reachable from Connect + landing; play, controls, correct product story (MCP, not fake AI-in-app) | Already shipped; verify |
| 23 | **OAuth consent copy** — Allow/Deny screen states what the agent can do (search/track, never apply without user) | Trust for the real AI surface |

### Settings / account (non-AI)

| # | Work | Notes |
|---|------|-------|
| 24 | **Preferences completeness** — agent prefs (location, level, employment, posted-within) round-trip via MCP `get/set_preferences` and show saved state in UI | This is the non-AI personalization lever |
| 25 | **Resume mirror honesty** — if read-only, say how to update (import path / MCP `set_resume`); no dead “edit” affordances | Settings already read-only |
| 26 | **Standing answers** — save/load custom Q&A used by agents; empty state + examples | Exists in Preferences |

---

## P2 — Completeness stretch (still no AI fluff)

| # | Work | Why |
|---|------|-----|
| 27 | **Saved searches (non-AI)** — name + persist current filter query; reopen from Jobs | Retention without LLM |
| 28 | **Optional email alert for saved search or followed company** — transactional only | Real alerts vs visit cursor |
| 29 | **Export tracker** (CSV/JSON) | Power-user completeness |
| 30 | **Remove orphaned UI / dead LLM actions from the tree** or quarantine behind `deprecated/` | Reduces false product surface area for future agents |
| 31 | **FOUC / theme flash** — void background before paint | Chrome completeness |
| 32 | **Mobile filter + detail pass** — Filters sheet, detail sheet, bottom tab, Save/auth on 390px | Same features, smaller viewport |
| 33 | **Stories / Trends / Company pages** — only if still linked from chrome; otherwise hide links until complete | Don’t leave half-linked destinations |

---

## Explicitly NOT doing (under this constraint)

| Tempting Jobright clone | Why skipped |
|-------------------------|-------------|
| Match % / sub-scores / “why this fits” in UI | AI fluff — belongs in user’s AI via MCP |
| In-app Orion / prep / cover letter / tailor | Dead code already; strategy says Connect |
| Autofill / Agent auto-apply | Out of thesis |
| Recommended feed powered by resume ML in our UI | Out of thesis; prefs + MCP search replace this |
| Interview question bank / human coaching | New product lines, not completing current ones |

If personalization pressure returns: ship **better prefs + MCP prompts**, not scores in the card.

---

## Suggested ship order (2–3 slices)

### Slice A — Trust & navigation (P0: 1–8)
Connect nav, Save labeling/guest save, sheet close, counts, salary, company names, dead marketing links, agent credentials in Settings.

### Slice B — Loops (P1: 9–19)
Job→Connect context handoff, JD formatting, sort/empty/follow copy, tracker sync messaging, apply-cap, mark-applied outcomes.

### Slice C — Retention without AI (P2: 27–32)
Saved searches, optional email, export, dead-code quarantine, mobile/FOUC.

---

## Acceptance checks (manual)

1. Logged-out: search → filter → open job → Save behavior is unsurprising → Track a role works → stage/remove persist after reload.  
2. Logged-in: Save from job → appears on Tracker with correct stage → Mark applied moves chip → Connect from detail gives usable handoff.  
3. Nav Connect → `/connect` → copy MCP URL → Settings shows/revokes agent access.  
4. No primary CTA advertises an AI feature that only exists as dead code.  
5. Spot-check 20 result rows: no absurd salary; company field is human-readable.

---

## One-line summary

**Finish the non-AI product:** honest data, coherent Save/Track/Connect loops, and a Connect surface that is findable and operable — without rebuilding AI inside Intervu.

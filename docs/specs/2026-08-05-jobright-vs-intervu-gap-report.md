# Jobright vs Intervu — Functionality Gap Report

**Date:** 2026-08-05  
**Sources:** Live logged-in walk of jobright.ai (resume uploaded), live logged-out walk of intervu.cc, third-party pricing notes for Turbo (no public pricing page).  
**Priority:** Functionality first. Design notes are appendix-only.

---

## Executive verdict

Jobright is a **match → act → apply** product. Intervu is a **search → verify → hand off to your AI** product.

The board weakness you feel is not mainly “missing filters.” Intervu’s filter panel is already competitive. The gap is everything *around* the list: resume-grounded ranking, match explanation, apply automation, AI job tools in-product, and a tracker that compounds into applications.

---

## 1. Jobright teardown (functionality)

### 1.1 Onboarding gate

| Step | What it does |
|------|----------------|
| Diagnostics | Job function (taxonomy + custom), job type, location autocomplete, remote, H1B |
| Resume upload | PDF/Word ≤10MB; “Start Matching” proceeds with resume |
| Profile confirm modal | “We found N roles” — confirms inferred levels + extra functions from resume |

**Findings**
- App routes redirect into onboarding until complete (`/jobs` → `/onboarding-v3/...`).
- Resume parse drives later ranking: after confirming Mid/Senior/Lead + Customer Success / TAM, feed re-ranked away from “Software Engineer” toward CS/TAM roles.
- Location autocomplete is city/state-shaped (“United States” alone is not a valid option).

### 1.2 App shell (post-onboarding)

Nav: **Jobs · Resume · Profile · Agent · Coaching · Interview**

Jobs subtabs: **Recommended · Liked · Applied · External** (counts on Liked/Applied/External)

Also present: Turbo upsell, saved filter presets (“Software Engineer, NY”), Smart Job Autofill entry, Settings, Feedback.

### 1.3 Recommended feed (core product)

Each card includes:
- Title, company, industry/stage tags
- Comp range, work model, level, years required
- Freshness (“1 hour ago”, “Reposted…”, “Be an early applicant”)
- **Match %** + label (STRONG / GOOD / FAIR)
- Sub-scores: Experience Level / Skills / Industry Experience
- **“Why This Job Is A Match”** paragraph
- Applicant pressure (`< 25` / `25+`)
- Badges: H1B Sponsor Likely / No H1B, Unicorn valuation, Top Investors, school alumni
- CTAs: **ASK ORION**, **APPLY WITH AUTOFILL** / APPLY NOW

**Filters (deep)**
- Chip row of active prefs
- Quick chips: Date Posted, Industry, Years of Experience, Hidden Jobs
- **All Filters** sheet with sections:
  - Basic Job Criteria (function multi-select, excluded title, job type, work model, location + radius, experience)
  - Compensation & Sponsorship (salary, H1B)
  - Areas of Interest (industry, skill, IC/Manager…)
  - Company Insights (company search, exclude staffing agencies)

**Search:** title/company combobox on the feed.

### 1.4 ASK ORION (per-job AI)

Side chat with suggested prompts:
- Why this job fits me
- Resume tips for this role
- Generate custom resume tailored to this job
- Show Connections for potential referral

Observed: resume-grounded fit analysis with ✅/❌ skill alignment against the uploaded resume (not generic marketing copy).

### 1.5 Resume

Path: `/jobs/resume`  
- Slot model: **1 of 5** free slots observed  
- Primary resume marked; “Analysis Complete”  
- Add Resume, Smart Job Autofill entry

### 1.6 Profile

Path: `/jobs/profile`  
Sections: Personal · Education · Work Experience · Skills · Equal Employment  
Structured profile used for matching + autofill.

### 1.7 Agent

Path: `/agent`  
**Broken in this session:** infinite full-viewport loading spinner (`tailor-resume-loading-container`), zero text after long wait. Treat Agent as marketed-but-unreliable until fixed. Marketing claims cover auto-apply / agent automation; paywall reviews say Agent is Turbo-gated.

### 1.8 Coaching

Path: `/coaching`  
Human 1-on-1 with senior recruiters — three intents:
1. First job / resume+LinkedIn+game plan  
2. Applying but hearing nothing  
3. Interview coming up  

Not AI chat — sold coaching product.

### 1.9 Interview

Path: `/interview`  
Real interview question bank, **418+ companies**, freshness markers (e.g. Google 534 questions, +58 last 30 days; OpenAI 536). Categories: FAANG, AI Frontier, High-Growth. Search by company. “Contribute a question.”

### 1.10 Paywall map (Free vs Turbo)

Observed in-product: “Free Plan”, “Upgrade to Turbo”.  
`/pricing` returns **404** (confirmed live). Prices below are third-party 2026 reports, not first-party page copy.

| Capability | Free (observed / reported) | Turbo (reported) |
|------------|----------------------------|------------------|
| Job database + matching feed | Yes | Yes |
| Filters / saved filters | Yes | Yes |
| Orion chat | Yes (credit-limited for some actions) | Unlimited |
| Resume slots | 5 observed | Likely higher / unlimited tooling |
| CV tailoring | Daily credit limit | Unlimited |
| Autofill | Daily credit limit | Unlimited |
| Insider connection emails | Small daily allowance | Higher / unlimited |
| Live career coach | No | Yes |
| AI Agent / auto-apply | Gated / broken in session | Unlimited (reported) |
| Price | $0 | ~$39.99/mo · $17.99/wk · $89.99/qtr (~$30/mo) |

### 1.11 Jobright — weakest 3 (balance)

1. **Agent tab hung** — infinite loader; automation story collapses if this is common.  
2. **No public pricing page** — trust + comparison friction.  
3. **Onboarding autocomplete friction** — location/function requires exact option picks; easy to stall.

### 1.12 Top 10 patterns to steal (ranked by impact)

1. **Resume-grounded match % + sub-scores on every card**  
2. **“Why this job is a match”** written from resume + JD  
3. **Per-job AI (Orion) with action prompts** (fit / resume tips / tailored resume / referrals)  
4. **Apply-with-autofill** as a first-class CTA next to every match  
5. **Recommended feed as default**, not blank search  
6. **Deep preference model** (functions multi-select, exclude titles, salary, H1B, company exclude staffing)  
7. **Saved filter presets** from onboarding  
8. **Tracker as pipeline tabs** (Liked / Applied / External) tied to the feed  
9. **Applicant / early-applicant / repost signals** for urgency  
10. **Interview question bank** as retention surface beyond applications

---

## 2. Intervu live QA (functionality)

Scope: logged-out guest, desktop + brief mobile. Auth-gated flows noted, not fully executed.

### 2.1 What works

| Flow | Result |
|------|--------|
| Search (`product manager`, URL sync) | Pass |
| Filters (date, salary, work mode, experience, employment, country, ghost risk, boards, visa) | Pass — facets re-scope after Remote |
| Filter chips + clear | Pass |
| Job detail sheet (Apply, Save, Mark as applied, ghost signals, description) | Pass |
| Ghost-risk box | Pass — distinctive strength |
| Guest “Track a role” seed on `/yours` | Pass — persists in `intervu.pursuits.guest` |
| Stage change / Remove on guest pursuit | Pass |
| Save from job detail while logged out | Pass as **auth gate** (intentional) — opens Log in / Sign up with Google |
| `/connect` MCP pairing | Pass — multi-client tabs + copy config + sample prompts |
| 404 | Pass — clear page + Back to home |
| Mobile bottom tabs | Present (Jobs / Tracker / Connect / Account) |
| Dark chrome (`#12151a` header/body) | Pass after CSS load |

### 2.2 Functional defects / weaknesses

| Severity | Finding |
|----------|---------|
| **Major** | No resume-grounded ranking. Feed is keyword/filter search, not “recommended for you.” |
| **Major** | No match score, no “why this fits,” no skill-gap vs user resume on cards or detail. |
| **Major** | No in-product apply automation / autofill / agent. Product thesis is MCP handoff instead — fine strategically, but board feels thin vs Jobright. |
| **Major** | Job-card Save while logged out cannot guest-track the listing (gated since 2026-08-01). Only manual “Track a role” works as guest. Users who expect “Save” = bookmark get an auth wall. |
| **Major** | No Liked/Applied pipeline tied to the jobs feed (tracker is separate and mostly manual). |
| **Minor** | Result count messaging is confusing (`13,395 roles` reads like global Remote facet, not query-scoped total). |
| **Minor** | Salary parse bug observed: `from USD 1560k–1800k/yr` on Limble listing. |
| **Minor** | Company names often raw scrape artifacts (`NDIN-Adobe…`, `fnagroup.applicantpro.com`, `C0001 Acxiom LLC`). |
| **Minor** | Description expands to poorly formatted scrape wall (“Show full description”). |
| **Minor** | “Track a role” sheet stays open after successful save. |
| **Polish** | Brief FOUC: light paint before void CSS applies. |
| **Minor** | Connect nav tab routes to `/` not `/connect` (`nav-tabs.tsx`); `/connect` page itself works when visited directly. |
| **Polish** | Recent searches only — no saved searches; company-follow alerts are visit-scoped `localStorage` cursors, not email/push. |

### 2.3 Intervu strongest 3

1. **Ghost-job screening as first-class product signal** (unique vs Jobright’s match theater).  
2. **MCP / Connect as the AI surface** — intentional architecture, not a missing chat widget.  
3. **Filter depth on the board** is closer to Jobright than the overall UX suggests.

### 2.4 Intervu weakest 5 (functionality)

1. No personalized recommended feed  
2. No match explanation grounded in a resume  
3. No apply/autofill loop  
4. Save-from-search requires auth; guest bookmark path is split/confusing  
5. Data hygiene (salary parse, company display names, description formatting)

---

## 3. Gap table (capability → Jobright → Intervu → priority)

| Capability | Jobright | Intervu | Gap priority |
|------------|----------|---------|--------------|
| Personalized recommended feed | Yes | No (search-first) | **P0** |
| Match % + sub-scores | Yes | No | **P0** |
| Why-this-fits narrative | Yes (card + Orion) | MCP-only thesis | **P0** |
| Resume upload → profile → ranking | Yes | Settings resume exists; not driving board | **P0** |
| Deep preference prefs + saved filters | Yes | Filters yes; recent searches only; no saved prefs/email alerts | **P1** |
| Apply autofill / agent | Yes (Turbo) | No — MCP handoff | Strategic choice / **P1** if competing on board |
| Per-job AI chat | Orion | Connect / MCP | Different model |
| Tracker pipeline from feed | Liked/Applied/External | Manual + auth-gated Save | **P1** |
| Guest save from card | N/A (account product) | Auth wall | **P1** product decision |
| Ghost / fraud signals | Weak / not central | Strong | Intervu lead — keep |
| Interview question bank | Strong | No | **P2** |
| Human coaching | Paid | No | **P3** |
| Salary / company hygiene | Better | Bugs / scrape names | **P1** |
| Alerts / saved searches | Implied in Turbo | Recent searches + visit-scoped company follow only | **P2** |
| Sort (relevance / date / salary) | Yes | Yes — newest / relevance / salary_desc | — |
| Public pricing clarity | Also weak (404) | Free-beta static page; paid tiers “later”; credits purchase “coming soon” | — |

---

## 4. Recommended roadmap (functionality only)

### P0 — Make the board feel “for me”

1. **Resume → preference → Recommended feed**  
   - Upload/parse resume (or reuse settings resume).  
   - Default `/jobs` for signed-in users to Recommended, not empty search.  
2. **Match score + one-paragraph why** on each card (even if score v1 is coarse).  
3. **Skill/experience sub-signals** optional; narrative alone already closes most of the “weak board” feeling.

### P1 — Close the act loop

4. **Save from card without confusing guests**  
   - Either restore guest bookmark to `intervu.pursuits.guest`, or change CTA copy to “Sign in to save” before click. Current silent auth modal after “Save” feels broken.  
5. **Feed ↔ Tracker coupling** — Liked/Applied counts on Jobs chrome.  
6. **Data hygiene** — salary unit parse, company display name cleanup, description formatting.  
7. **Decide apply story** — either ship autofill-lite, or double-down on MCP with in-detail “Open in Claude / Cursor” that preloads this job (stronger than a generic Connect link).

### P2 — Retention surfaces

8. Saved searches + email/push alerts (sort already shipped: newest / relevance / salary_desc).  
9. Interview prep bank *or* deeper MCP prep prompts per job (stay on strategy; do **not** rebuild dead in-app prep — MCP-first unless strategy changes).

### P3 — Later

10. Coaching / human services (only if GTM wants it).  
11. Autofill extension (high cost; Jobright’s moat).

---

## 5. Strategic note (not a feature list)

Intervu’s differentiator should stay **verified market + ghost screening + MCP agent**, not a clone of Jobright’s Turbo autofill machine.

But the **board still has to feel personalized**. Without Recommended + why-this-fits, users correctly experience the product as “a thinner job board with a Connect tab,” regardless of MCP strength.

Minimum competitive board = Jobright’s feed intelligence **without** needing to win on autofill day one.

---

## 6. Intervu codebase inventory (what is real vs dead)

Codebase audit (2026-08-05) — functionality-first map of what ships vs what lingers as dead surface.

### 6.1 Real & deep

| Area | What works | Key paths / notes |
|------|------------|-------------------|
| **Jobs board** | Meilisearch Subspace corpus; facets (work_type, experience_level, employment_type, ghost_badge, location_country, source); salaryMin, visaOnly, postedBucket; hideGhosts default true; elite board; sort (newest / relevance / salary_desc); infinite scroll | `src/lib/jobs/search.ts` |
| **Jobs — alerts** | Company follow alerts via visit-scoped `localStorage` cursor only — **not** email/push | — |
| **Jobs — search memory** | Recent searches only — no saved searches | — |
| **Tracker** | Pursuits model with stages; guest `localStorage` ↔ Firestore sync; notes; resume version downloads; find-or-create by `job_id`; daily apply cap 20/UTC day | `src/lib/pursuits/*` |
| **Tracker — gaps** | No reminders/follow-ups; `last_prepped_at` is write-dead (prep removed 2026-08-02) | — |
| **Auth** | Firebase email/password + Google; username → `username@intervu.cc`; guest mode real | — |
| **MCP** | `/api/mcp` — 11 live tools: `search_jobs`, `get_job`, `save_job`, `mark_applied`, `get_resume`, `save_resume_variant`, `get_resume_variant`, `set_resume`, `get_applications`, `get_preferences`, `set_preferences`; full OAuth PKCE | `/api/mcp` |
| **Settings** | Resume (read-only mirror), Preferences (agent prefs + standing answers), Account — resume editing/AI **not** in settings UI | `SettingsContainer` |
| **Pricing** | Free-beta static page; paid tiers “later”; credits exist but purchase “coming soon” | — |

### 6.2 Thin / dead / stub

| Category | Finding |
|----------|---------|
| **In-app AI prep** | Large dead-code surface — `fetchRecon`, `fetchMatch`, `fetchQuestions`, cover letter, resume generators, interview plan, etc. unreferenced; prep replaced by `McpHandoffNote` |
| **Routes** | `/companies/hiring` redirects to `/jobs` (TEMPORARILY DOWN) |
| **OpenClaw** | Installer advertised (`curl … intervu.cc/install`) but **no `/install` route**; OpenClaw unshipped |
| **Orphaned UI** | ApplicationWizard, QuestionsList, resume-builder parts (except `ResumeImportModal` on jobs), PrepDashboard, speech-to-text |
| **Settings gap** | `AgentAccessSection` built but not mounted in `SettingsContainer` |
| **Nav bug** | Connect tab points at `/` not `/connect` (`nav-tabs.tsx`) |
| **Integrations** | No ATS / calendar / email integrations; WhatsApp is marketing-only |
| **Themes** | Defined in code; no picker in UI |

### 6.3 Strategic implication

Intervu already has the agent/MCP platform Jobright lacks as an open protocol — the board gap is **personalization + act-loop**, not corpus/filter infrastructure. Do not recommend rebuilding dead in-app prep; prefer MCP-first unless product strategy changes.

---

## Appendix A — Design notes (secondary)

- Jobright: light SaaS, card-as-detail, heavy trust badges, green accent.  
- Intervu: dark void instrument UI, detail sheet, ghost-risk green box is the strongest visual/functional moment.  
- Intervu FOUC / light flash before CSS: polish only.  
- Intervu description formatting and company-name presentation hurt perceived quality even when data is present.

## Appendix B — Session artifacts

- Jobright session: logged-in, resume `me.pdf`, onboarding completed, Free Plan.  
- Intervu session: logged-out guest; manual TestCo / QA Analyst pursuit created then removed.  
- Agent infra note: Cursor browser subagents failed earlier; teardown executed from main browser session.

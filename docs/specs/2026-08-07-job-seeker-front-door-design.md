# Job-seeker front door — design

**Date:** 2026-08-07 · **Status:** Approved by Vivek (brainstorm session) · **Branch:** `feat/job-seeker-front-door`

## Decision

Intervu's first customer is the **non-technical job seeker** — someone who has never
heard of Claude, MCP, or agents, and only wants low-friction help getting a job.
The tech-adjacent user (already has an AI subscription) keeps a clearly signposted
corner but no longer owns the front door.

One-line promise the whole surface serves:

> **"Every job here is real, and we tell you which ones aren't worth your time."**

This extends, not replaces, the locked 2026-08-05 thesis
(`docs/specs/2026-08-05-intervu-completeness-no-ai-fluff.md`): verified market +
ghost screening + tracker + MCP handoff, no in-app AI fluff. What changes is which
audience the front door speaks to.

## Ground truth (audited 2026-08-07 at `origin/main` = dac1039)

- The landing panel's default active lane on first paint is the **Claude/ChatGPT
  connector tab**, not the job board — `useState<LandingLane>("mcp")` at
  `src/components/marketing/InstrumentDeck.tsx:54`. A stranger's first sight of
  intervu is an MCP connector URL and "Paste as a custom connector…".
- The `<title>`/OG copy on `/` is **"Intervu — an overnight job-search agent"**
  with description `OPENCLAW_SUBLINE` ("A skill for OpenClaw, the open-source
  assistant you run on your own machine…") — `src/app/page.tsx:10,16` and
  `src/components/marketing/openclaw-content.ts:30-31`. This is what every search
  result, browser tab, and WhatsApp link preview shows before any click.
- Landing-panel copy runs roughly 2:1 machinery over outcome (copy audit,
  2026-08-07). Outcome copy that already works: `INSTRUMENT_META` = "Find the job
  postings that are hiring" (`openclaw-content.ts:55`), ghost-risk badges, the
  guest blur-gate copy on `JobDetail`.
- The global footer says "Same market your agent sees via MCP."
  (`src/components/layout/Footer.tsx:30`) — on every page, including guest browse.
- `/jobs` is genuinely public (search/filter/scroll ungated); the only gate is the
  blur on the job-detail sheet. All eight P0 honesty fixes from the 2026-08-05
  spec are verified done at this commit.
- `/trends` is the strongest guest page: fully rendered, no login, live corpus
  numbers ("Live jobs right now 1,831,693 · Flagged likely-ghost, live 40,635" —
  live-site observation 2026-08-07, point-in-time).
- Still-open job-seeker gaps: saved searches stubbed to recent-searches-only,
  follow/search alerts are a per-visit `localStorage` cursor (no email/push),
  follow-alert copy honesty (P1 #14), tracker completeness re-verification
  (P1 #17), mobile/FOUC polish (P2 #31/#32).

## Phase 1 — Flip the front door (one implementation plan; copy + defaults, no redesign)

1. **Default lane = job board.** Change the initial lane at
   `InstrumentDeck.tsx:54` from `"mcp"` to the board lane; reorder tabs to
   Job board → Claude/ChatGPT → OpenClaw. Enthusiasts reach their tabs in one
   click; strangers never need to.
2. **Rewrite title/meta/OG.** Shape: *"Intervu — a job board that screens out
   ghost postings"*; description built from the outcome and the corpus numbers
   (live roles from companies' own career pages, ghost-flagged before you waste
   an application). No "skill", "agent", "OpenClaw", "MCP", or "WhatsApp"
   anywhere in `/` metadata. `OPENCLAW_SUBLINE` may keep its current text where
   the OpenClaw audience has self-selected (e.g. inside the OpenClaw lane), but
   it no longer feeds `/` metadata.
3. **Outcome-first landing copy.** The board lane leads with the promise plus the
   live trust numbers (same source `/trends` uses — `formatCorpusCount` /
   corpus-count lib). Machinery copy retreats inside the two AI tabs.
4. **Guest-surface jargon sweep.** Fix machinery language only where a logged-out
   browser sees it. Known offenders from the 2026-08-07 copy audit: the global
   footer MCP line (`Footer.tsx:30`), `/jobs` loading/footer copy referencing
   MCP/agents, and connect-health copy if it leaks into guest surfaces.
   `/connect` internals may stay technical — that audience opted in.

**Class rule for the sweep:** the fix is per-surface (guest-visible vs
opted-in-technical), not per-string. Any copy a logged-out, non-technical visitor
can reach must promise an outcome in plain words; copy behind an explicit
AI-lane/Connect choice may use technical terms.

## Phase 2 — The invisible assistant (ordered backlog; each item is its own plan)

Deliver "automation" without asking anyone to understand it. All items obey the
no-inference rule: **surface facts, never conclusions** ("Open 131 days ·
reposted twice", not "your odds are low").

1. **Honest nudges from data we already hold** — job sheet + tracker: days open,
   repost count, company fill/close history. Gate: each nudge's backing field
   gets a type + queryability check during planning, before it is promised.
2. **Real email alerts** for saved searches and company follows — the single
   biggest "it works while I sleep" feature needing zero AI comprehension.
   Gate: verify what sending infrastructure already exists first; if it requires
   a new paid service, that is Vivek's explicit call before any build.
3. **Saved searches for real** (replace the recent-searches stub).
4. **Tracker completeness + mobile pass** (re-verify P1 #17, P2 #31/#32).

## Out of scope

- Match scores, "why this fits", per-job chat, resume tailoring UI, autofill —
  the 2026-08-05 no-AI-fluff line stands unchanged.
- Hosted apply-for-me — parked; collides with the local-first hard rule and the
  founding wound (AI must never invent on the user's behalf).
- Windows local agent — waitlist keeps measuring demand.
- `/connect` login gate — no longer on the family path; stays an open item, not
  scope creep here.

## Success test

A non-technical person landing on intervu.cc reads a promise about **jobs** — not
agents — and reaches a real job in two clicks without encountering a single AI
word. A link shared over WhatsApp previews with the same job-board promise.

## Accepted trade-off

Demoting the connector tab will likely slow MCP-connect signups from cold
traffic. Accepted deliberately: cold traffic was not converting through a
connector URL, and warm/technical visitors are one click away.

## Open questions carried into planning

- Exact new title/description strings (marketing pass during planning; keep the
  read-aloud test from the human-voice rule).
- Whether the corpus numbers on the landing board lane render server-side (SEO +
  no-JS previews) or reuse the client path `/trends` uses.
- Which jargon strings beyond the audited list are guest-reachable — the plan
  should re-grep guest routes rather than trust the audit list alone.

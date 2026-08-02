# "intervu works with your agent" — MCP differentiation design

**Date:** 2026-08-02 · **Status:** approved by Vivek (brainstorm session) · **Goal class:** differentiation story, timeboxed side-quest (must not displace the thesubspace.io Sep 30 first-dollar gate)

## Decisions log (all confirmed by Vivek)

1. **Primary goal:** differentiation story — a credible working demo + a visible "works with your agent" product surface. NOT (yet) a supported platform bet or an acquisition channel.
2. **Mechanism:** thin remote MCP server with per-user tokens. Not an npm stdio package, not REST-only.
3. **Demo stopping point:** agent preps everything and stops at the ATS review screen; the human hits submit. No autonomous submission, ever, anywhere in the story.
4. **MCP shape:** Streamable HTTP endpoint served by the existing Next app, bearer-token auth.

## Positioning

Auto-apply products (Simplify, LazyApply, AIApply) own the automation and therefore the arms race: ATS breakage, CAPTCHAs, ToS liability, spam reputation. intervu inverts it — **the user brings their own agent; intervu is the targeting layer that makes it accurate.** intervu supplies verified targets, truth signals, and the apply URL; the user's agent does the form work on the ATS site; the human approves the submit.

One-liner direction: *"Bring your own agent. We make sure it applies to real jobs."*

## Architecture

- **Endpoint:** new route handler in the intervu Next app (working name `POST /api/mcp`), implementing MCP **Streamable HTTP** transport with the official `@modelcontextprotocol/sdk`. Served from the existing Contabo container behind Caddy. No new service, no new host.
- **Search path reuse:** tools call the existing `src/lib/jobs/search.ts` path (same code the UI's Server Action uses). No parallel query implementation. (Ground truth from repo scout: no REST job API exists today — search is a Server Action, so this route is net-new surface but reuses the whole search lib.)
- **Auth:** `Authorization: Bearer <token>`. First personal-access-token infra in intervu:
  - New **Settings → Agent access** section: generate one token, revoke/regenerate. Show a copy-paste connection snippet (OpenClaw / Claude Code / Claude Desktop).
  - Token stored **hashed**; lookup maps token → Firebase user. Storage backend: same store that backs pursuits/user data — the implementation plan must confirm which store that is (unverified at design time).
- **robots/discovery:** add `llms.txt` at the site root pointing agents to the endpoint + `/agents` docs page.

## MCP tools (v1 — exactly four)

| Tool | R/W | Contract |
|------|-----|----------|
| `search_jobs` | R | Query + filters (role text, location, remote, posted-within — **default 30 days**, Vivek's standing rule). Returns compact hits: title, company, location, `ghost_badge`, `posted_at`, `first_seen_at`, `updated_at`, `vacancy_status`, `apply_url`, job id. Result cap: 20 per call. |
| `get_job` | R | Full job detail by id, including description + `apply_url`. Description text wrapped/labelled as untrusted third-party content (see Security). |
| `save_job` | W | Adds the job to the calling user's pursuits/tracker. Own-account only. |
| `mark_applied` | W | Records an application in the calling user's tracker. Own-account only. This is the sticky differentiator: **intervu is the agent's memory** — the tracker stays true even when a robot did the legwork. |

**Truth-claim scope v1:** `ghost_badge` (coarse enum — raw scores stay excluded, existing payload policy) + freshness timestamps + `vacancy_status`. **Company close-rate is OUT of v1** — it is not in this repo's payload (scout-verified); pulling it from Subspace is a separate data task that would break the "thin" constraint.

## Corpus-protection guardrails (load-bearing)

thesubspace.io is about to sell this corpus to investors (alt-data pivot, Aug 1). The MCP must serve a job-seeker's session, never bulk export:

- Coarse enum fields only; no raw scores; no fields beyond what the web UI already shows.
- Per-token rate limit (~60 req/hr, tunable) + per-call result caps.
- No list-everything/dump tool; search always requires a query or filter.
- Tokens revocable; abuse observable per token.

## Demo (the story artifact)

Script: user tells OpenClaw *"Find me 5 real senior-engineer roles posted this month — skip anything ghost-flagged — and prep the applications."* Agent: `search_jobs` → picks verified-live, non-ghost jobs → opens each real ATS page via `apply_url` → fills forms from the user's profile/resume → **stops at each review screen** → after the human submits, `mark_applied` updates the tracker. Recorded as a video, hosted on `/agents`.

- **Build-task #1 (verification):** confirm OpenClaw's native MCP-client support. UNVERIFIED at design time. Fallback: a ~20-line OpenClaw skill calling the same HTTP endpoint — same demo, same claim.
- Demo uses a realistic demo account, **not** `vvk/vvk` (reads fake on camera).
- No real application is submitted during recording.

## Site surface

1. **`/agents` public page:** the claim, the demo video, connect instructions per client (OpenClaw, Claude Code, Claude Desktop), honest scope statement ("we never submit for you; your agent prepares, you approve"), prompt-injection note for agent users.
2. **Settings → Agent access:** token generate/revoke + connection snippet.
3. **`llms.txt`** at root.

## Distribution (stealth-checked 2026-08-02 against outreach-constraints.md)

- **In-bounds now:** the `/agents` page + hosted video (owned surface); X `@thesubspaceio`; Substack post framed as a data story; agent-community Discords as the brand.
- **Out per Vivek's own rules:** Reddit (product demo = product plug; data-stories-only rule), LinkedIn/Facebook/Show HN/cold-email-at-scale (blocked list).
- **Pending Vivek's explicit OK (new channel class, not decided here):** ClawHub skill listing + MCP directory listings — free, brand-level, pseudonymous (same shape as the approved Neudata/Datarade class).

## Security (preview — full `security-pass` before ship)

- Hashed, revocable tokens; constant-time comparison; no token logging.
- Writes scoped strictly to the authenticated user's own records.
- Rate limits as above; MCP route excluded from any CDN/page caching.
- **Prompt injection:** job descriptions are third-party text flowing into users' agents. A poisoned description is an injection vector into *their* agent. Tool responses label description content as untrusted data; `/agents` docs state it plainly.

## Non-goals (v1)

- intervu never submits applications, hosts automation, or stores agent transcripts.
- No company close-rate field.
- No paid gate: free with an account, rate-limited (the user already pays for their agent). Gating later is a one-way door Vivek can open, not a v1 decision.
- No guarantee any specific third-party agent works; OpenClaw + Claude clients are the tested set.

## Open items for the implementation plan

1. Verify OpenClaw MCP-client support (or write the fallback skill).
2. Confirm the storage backend for pursuits/user data → token store follows it.
3. Rate-limit implementation point (middleware vs. in-route) given the Caddy/Next stack.
4. Demo account setup with a realistic profile + resume.
5. Vivek's yes/no on ClawHub + MCP-directory listings.

## Estimate

MCP route + token infra + settings UI + `/agents` page + `llms.txt`: ~1–2 focused days. Demo recording + video edit: additional. Timebox honestly; the alt-data pivot outranks this.

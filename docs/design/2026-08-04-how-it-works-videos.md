# How it works — two explainer videos (locked brief)

**Status:** locked for production — decisions frozen 2026-08-04  
**Reference:** [arc.heurystic.com](https://arc.heurystic.com/) hero (`hero_section_video_v2.mp4`, ~16s, muted, loop)  
**Placement (later):** InstrumentDeck Claude/ChatGPT + OpenClaw lanes → small **how it works** → modal player (not wired in v1)

---

## Locked decisions

| # | Decision | Lock |
|---|---|---|
| 1 | **MCP hero client** | **Claude-first.** One continuous shot through Claude Desktop only. ChatGPT mentioned in modal caption/subtitle only — no in-video tab switch, no split-screen, no modal tabs inside the clip. |
| 2 | **Resume beat** | **Omit from both v1 clips.** No resume upload coda after pairing. End state for Video A is “paired + verified roles in chat.” OpenClaw WhatsApp digest may show a *draft* resume chip (agent output) — that is not a “upload your resume” beat. |
| 3 | **Production path** | **AI-animate from locked keyframes first** (Runway Gen-3 / Pika / Kling — pick one, iterate fast). Commission Arc-style motion (Fiverr/Motion) **only if** the AI loop reads cheap after 2–3 iteration passes. |
| 4 | **Account-first product rule** | **Pair-first / resume-via-agent** for v1 video and onboarding messaging. Do not force account + resume upload before OAuth in the video story or primary install copy. Resume comes later via agent `set_resume` or Settings — as coded today. |

---

## Style bible (shared — match Arc)

| Axis | Spec |
|---|---|
| POV | First-person desk, hands in frame |
| Mood | Lo-fi anime / clean digital illustration, cozy night study |
| Set | Warm desk lamp, rainy window, monstera, coffee steam, wooden desk |
| Product | Lives **on the laptop/phone UI** — no floating captions, badges, or stickers over the scene |
| Audio | Mute + loop (Arc pattern). Optional soft lo-fi bed later — not required for v1 |
| Length | **~14s** each (5 beats × ~3.2s hold, 0.5s crossfade), seamless loop |
| Format | 1920×1080 H.264 `.mp4`, poster PNG from pain keyframe |
| Brand | Dark intervu UI on-screen (`#12151a` void, iris `#7cb87a`); no purple neon |

**Keyframe comps:** `docs/design/how-it-works-keyframes/`

| File | Beat it locks |
|---|---|
| `intervu-video-a-mcp-keyframe-0-pain.png` | A · Pain — ghost jobs, tab chaos, blank Claude chat |
| `intervu-video-a-mcp-keyframe-1.png` | A · Connect — Claude Settings → custom connector, URL pasted |
| `intervu-video-a-mcp-keyframe-2.png` | A · Approve — browser OAuth, Allow hover |
| `intervu-video-a-mcp-keyframe-3-ask.png` | A · Ask — user types job-search prompt in Claude |
| `intervu-video-a-mcp-keyframe-4-relief.png` | A · Relief — 3 verified roles returned in chat |
| `intervu-video-b-openclaw-keyframe-0-pain.png` | B · Pain — apply fatigue, tab chaos, spreadsheet of apps |
| `intervu-video-b-openclaw-keyframe-1.png` | B · Install — terminal curl scroll |
| `intervu-video-b-openclaw-keyframe-2-auth.png` | B · Auth — browser OAuth Allow beside terminal |
| `intervu-video-b-openclaw-keyframe-3-overnight.png` | B · Overnight — agent runs at 2 AM, user asleep |
| `intervu-video-b-openclaw-keyframe-2.png` | B · Relief — WhatsApp digest + draft chip |

---

## Video A — Claude MCP

**Job:** Show the pain of ghost jobs and blank chat, then prove pairing → ask → verified roles in ~14s.  
**Hero client:** Claude Desktop (continuous). ChatGPT = caption only: *“Works with ChatGPT too — same connector URL.”*  
**CTA after watch:** Copy `https://intervu.cc/api/mcp` (already on the lane).

| t | Beat | Plate action | UI detail (must match keyframes) |
|---|---|---|---|
| 0.0–2.5s | **Pain** | Hands scroll trackpad wearily. Rain on window. | Browser tab chaos — ghost “no longer available” postings, irrelevant listings. Claude chat open but **empty** — no market data. Sticky note: “still searching”. |
| 2.5–5.0s | **Connect** | Left hand on trackpad; right types. | Claude **Settings → Connectors → Create custom connector**. Fields: Name `intervu`, Type `MCP Server`, URL `https://intervu.cc/api/mcp` (iris `#7cb87a` valid-state ring). Click **Save**. |
| 5.0–7.5s | **Approve** | Browser sheet slides over chat (same laptop — no cut to phone). | OAuth: **“Claude wants to connect”** → caps with green checks: *Search jobs*, *Save to tracker*, *Never apply without you* → cursor on **Allow**. |
| 7.5–10.0s | **Ask** | Browser dismisses; back in Claude chat. User types one line. | Prompt: *“Find senior PM roles in Berlin posted this week.”* Send button iris green. Claude typing indicator. |
| 10.0–14.0s | **Relief** | Hands relax. Warm satisfaction. | Agent returns **3 verified jobs** (title + company + “Verified” badge + link chips). Loops cleanly to Pain. **No resume upload.** |

**Must show:** pain of ghost jobs / empty chat; browser OAuth approve moment; verified role results.  
**Must not show:** resume upload, ChatGPT UI, tab picker, “account + resume before OAuth” gate.  
**End state:** paired + real verified jobs in chat.

**VO (optional subtitle strip — not burned into plate):**  
“Stop scrolling ghost jobs. Paste the connector. Ask once — get verified roles.”  
**Caption (modal, not in video):** “Works with ChatGPT too.”

---

## Video B — OpenClaw

**Job:** Show apply fatigue, then prove one install → auth → overnight → WhatsApp review in ~14s.  
**CTA after watch:** Copy `curl -fsSL https://intervu.cc/install | bash`.

| t | Beat | Plate action | UI detail (must match keyframes) |
|---|---|---|---|
| 0.0–2.5s | **Pain** | Right hand on mouse, left on forehead. Exhausted posture. | Browser **tab chaos** — 15+ tabs, “Application submitted”, spreadsheet with 40+ rows. Post-it: “47 apps today”. Clock: 4:47 PM. |
| 2.5–5.5s | **Install** | Right hand on mug; left on keyboard. Paste + Enter. | Run `curl -fsSL https://intervu.cc/install \| bash`. Log scrolls: OpenClaw · mcporter · skill → **Installation complete**. |
| 5.5–8.0s | **Auth** | Browser pops beside terminal (same machine). | OAuth: **“OpenClaw wants to connect”** → caps: *Run job search locally*, *Draft tailored resumes*, *Never apply without you* → cursor on **Allow**. Terminal: `Awaiting browser auth…` |
| 8.0–11.0s | **Overnight** | Chair empty — user asleep. Lamp dimmed. Moonlight. | Terminal logs scroll: *Scanning 12 boards…*, *Found 3 matches*, *Tailoring resume…*, *Draft ready*. Clock: 2:14 AM. |
| 11.0–14.0s | **Relief** | Phone lifts into frame (right hand). Morning light. | WhatsApp from intervu: *“3 fit you today…”* + **draft resume PDF chip** + *“Review and hit submit.”* Agent stops before submit — user still in control. Loops to Pain. |

**Must show:** apply-fatigue pain; self-hosted terminal + browser OAuth + overnight agent + WhatsApp as review channel.  
**Must not show:** hosted waitlist as install path; auto-submit; resume upload screen.  
**End state:** skill installed + digest waiting for human review.

**VO (optional subtitle strip — not burned into plate):**  
“Stop applying all day. One command. Wake up to a draft ready for your review.”

---

## Differences (lane clarity)

| | A · MCP | B · OpenClaw |
|---|---|---|
| Hero device | Laptop · Claude chat | Terminal → phone |
| Win moment | Verified roles in chat (not ghost jobs) | Overnight WhatsApp digest + draft |
| Pain shown | Ghost jobs, blank chat | Apply fatigue, tab chaos |
| Effort signal | Paste URL | One curl |
| Who runs the agent | Claude cloud | Your machine |
| Resume in clip | **None** | Draft chip only (agent output, not upload) |

Same desk world = brand continuity; different climax = lane clarity.

---

## Production workflow

1. **Keyframe comps** — 5 PNGs per video in `how-it-works-keyframes/` (pain → mechanics → relief).
2. **Ken Burns loops** — `./build-loops.sh` in `how-it-works-videos/` generates H.264 from keyframes (3.2s hold, 0.5s crossfade, subtle zoom). Target ~14s, 24fps, seamless loop pain ↔ relief handoff.
3. **Review pass** — check OAuth text legibility at 400px modal width; iris green on caps checks; pain beats readable; no purple drift.
4. **Fallback** — if motion feels stiff/cheap after 2–3 AI passes, brief a motion designer with these keyframes + beat tables (Arc reference link above).
5. **Deliverables** — `video-a-mcp-loop.mp4`, `video-b-openclaw-loop.mp4`, poster PNGs from pain keyframe of each.

---

## UI hook (for later — not building in this PR)

On InstrumentDeck when lane is `mcp` or `claw`:

```
[ hint text ]
[ how it works ]   ← quiet text button under the command slab
```

Click → modal with looping muted video + poster. No autoplay with sound. ChatGPT note lives in modal caption for lane `mcp` only.

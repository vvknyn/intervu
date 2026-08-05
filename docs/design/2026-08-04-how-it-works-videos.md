# How it works — two explainer videos (locked brief)

**Status:** locked for production — decisions frozen 2026-08-04  
**Reference:** [arc.heurystic.com](https://arc.heurystic.com/) hero (`hero_section_video_v2.mp4`, ~16s, muted, loop)  
**Placement (later):** InstrumentDeck Claude/ChatGPT + OpenClaw lanes → small **how it works** → modal player (not wired in v1)

---

## Locked decisions

| # | Decision | Lock |
|---|---|---|
| 1 | **MCP hero client** | **Claude-first.** One continuous shot through Claude Desktop only. ChatGPT mentioned in modal caption/subtitle only — no in-video tab switch, no split-screen, no modal tabs inside the clip. |
| 2 | **Resume beat** | **Omit from both v1 clips.** No resume upload coda after pairing. End state for Video A is “paired + can search.” OpenClaw WhatsApp digest may show a *draft* resume chip (agent output) — that is not a “upload your resume” beat. |
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
| Length | **14–18s** each, seamless loop |
| Format | 1920×1080 H.264 `.mp4`, poster PNG from beat 1 keyframe |
| Brand | Dark intervu UI on-screen (`#12151a` void, iris `#7cb87a`); no purple neon |

**Keyframe comps:** `docs/design/how-it-works-keyframes/`

| File | Beat it locks |
|---|---|
| `intervu-video-a-mcp-keyframe-1.png` | A · Connect — Claude Settings → custom connector, URL pasted |
| `intervu-video-a-mcp-keyframe-2.png` | A · Approve — browser OAuth, Allow hover |
| `intervu-video-b-openclaw-keyframe-1.png` | B · Install — terminal curl scroll |
| `intervu-video-b-openclaw-keyframe-2.png` | B · WhatsApp — overnight digest + draft chip |

---

## Video A — Claude MCP

**Job:** Prove pairing is three clicks, not a docs rabbit hole.  
**Hero client:** Claude Desktop (continuous). ChatGPT = caption only: *“Works with ChatGPT too — same connector URL.”*  
**CTA after watch:** Copy `https://intervu.cc/api/mcp` (already on the lane).

| t | Beat | Plate action | UI detail (must match keyframes) |
|---|---|---|---|
| 0.0–2.0s | **Arrive** | Desk establish. Rain on window. Hands rest on keyboard. | Laptop wakes to **Claude** home — not ChatGPT, no app switch. |
| 2.0–5.5s | **Connect** | Left hand on trackpad; right types. | Claude **Settings → Connectors → Create custom connector**. Fields: Name `intervu`, Type `MCP Server`, URL `https://intervu.cc/api/mcp` (iris `#7cb87a` valid-state ring). Click **Save**. |
| 5.5–9.5s | **Approve** | Browser sheet slides over chat (same laptop — no cut to phone). | OAuth: **“Claude wants to connect”** → caps with green checks: *Search jobs*, *Save to tracker*, *Never apply without you* → cursor on **Allow**. |
| 9.5–14.0s | **Ask** | Browser dismisses; back in Claude chat. User types one line. | Prompt: *“Find senior PM roles in Berlin posted this week.”* Agent returns **3 verified jobs** (title + company + link chips). |
| 14.0–16.0s | **Loop** | Soft dissolve to connector list / empty URL field. | Copy affordance visible — loops cleanly to Arrive. **No resume upload.** |

**Must show:** browser OAuth approve moment; intervu caps list.  
**Must not show:** resume upload, ChatGPT UI, tab picker, “account + resume before OAuth” gate.  
**End state:** paired + can search.

**VO (optional subtitle strip — not burned into plate):**  
“Paste the connector. Approve once. Ask for jobs.”  
**Caption (modal, not in video):** “Works with ChatGPT too.”

---

## Video B — OpenClaw

**Job:** Prove the overnight path: one install command → auth → WhatsApp review.  
**CTA after watch:** Copy `curl -fsSL https://intervu.cc/install | bash`.

| t | Beat | Plate action | UI detail (must match keyframes) |
|---|---|---|---|
| 0.0–2.0s | **Arrive** | Same desk world as Video A (continuity). Terminal focused. | Rain, lamp, monstera — match A palette. `$` prompt idle. |
| 2.0–6.0s | **Install** | Right hand on mug; left on keyboard. Paste + Enter. | Run `curl -fsSL https://intervu.cc/install \| bash`. Log scrolls: OpenClaw · mcporter · skill → **Installation complete**. |
| 6.0–10.0s | **Authenticate** | Browser pops beside terminal (same machine). | Same OAuth family as MCP — **Allow** within beat. Terminal logs `Auth complete.` |
| 10.0–14.0s | **WhatsApp** | Phone lifts into frame (right hand). | Message from intervu: *“3 fit you today…”* + **draft resume PDF chip** + *“Review and hit submit.”* Agent stops before submit — user still in control. |
| 14.0–16.0s | **Loop** | Phone dims; terminal idle prompt. | Seamless loop to Arrive. **No resume upload UI** — draft is agent output, not onboarding upload. |

**Must show:** self-hosted terminal + browser OAuth + WhatsApp as review channel.  
**Must not show:** hosted waitlist as install path; auto-submit; resume upload screen.  
**End state:** skill installed + digest waiting for human review.

**VO (optional subtitle strip — not burned into plate):**  
“One command. Approve in the browser. It texts you when a draft is ready.”

---

## Differences (lane clarity)

| | A · MCP | B · OpenClaw |
|---|---|---|
| Hero device | Laptop · Claude chat | Terminal → phone |
| Win moment | Jobs answer in chat | Overnight WhatsApp digest |
| Effort signal | Paste URL | One curl |
| Who runs the agent | Claude cloud | Your machine |
| Resume in clip | **None** | Draft chip only (agent output, not upload) |

Same desk world = brand continuity; different climax = lane clarity.

---

## Production workflow

1. **Animate keyframes** — interpolate between the four locked PNGs per video (2 beats each). Target 14–16s, 24fps, seamless loop on beat 1 ↔ beat 2 handoff.
2. **Review pass** — check OAuth text legibility at 400px modal width; iris green on caps checks; no purple drift.
3. **Fallback** — if motion feels stiff/cheap after 2–3 AI passes, brief a motion designer with these keyframes + beat tables (Arc reference link above).
4. **Deliverables** — `video-a-mcp-loop.mp4`, `video-b-openclaw-loop.mp4`, poster PNGs from keyframe 1 of each.

---

## UI hook (for later — not building in this PR)

On InstrumentDeck when lane is `mcp` or `claw`:

```
[ hint text ]
[ how it works ]   ← quiet text button under the command slab
```

Click → modal with looping muted video + poster. No autoplay with sound. ChatGPT note lives in modal caption for lane `mcp` only.

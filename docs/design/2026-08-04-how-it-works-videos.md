# How it works — two silent explainer videos (locked brief)

**Status:** locked for production — decisions frozen 2026-08-04  
**Revision:** silent explainer pivot (2026-08-04) — UI-forward, captions burned in, post-setup weighted  
**Reference:** [arc.heurystic.com](https://arc.heurystic.com/) hero (muted loop) + App Store preview / Loom-silent clarity  
**Placement (later):** InstrumentDeck Claude/ChatGPT + OpenClaw lanes → small **how it works** → modal player (not wired in v1)

---

## Silent explainer principle

These are **not** Ken Burns desk montages. Each beat must read as a **silent product explainer**:

| Rule | Spec |
|---|---|
| Captions | **Burned into every beat** — step badge (1/2/3…) + 3–6 word caption + UI frame |
| Legibility | Readable at modal width (~400px); ffmpeg `drawtext` reinforces keyframes |
| Visual style | UI mock progressions showing the **action**, dark intervu `#12151a`, iris `#7cb87a` |
| Audio | **None required** — fully self-explanatory if muted |
| Runtime split | **~60%+ after auth/setup** — usage beats dominate |

---

## Locked decisions

| # | Decision | Lock |
|---|---|---|
| 1 | **MCP hero client** | **Claude-first.** One continuous shot through Claude Desktop only. ChatGPT mentioned in modal caption/subtitle only — no in-video tab switch, no split-screen, no modal tabs inside the clip. |
| 2 | **Resume beat** | **Omit from both v1 clips.** No resume upload coda after pairing. OpenClaw WhatsApp digest may show a *draft* resume chip (agent output) — that is not a “upload your resume” beat. |
| 3 | **Production path** | **UI keyframe comps + ffmpeg loop builder** (`build-loops.sh`). AI keyframes with burned captions; drawtext overlay for legibility. |
| 4 | **Account-first product rule** | **Pair-first / resume-via-agent** for v1 video and onboarding messaging. Do not force account + resume upload before OAuth in the video story or primary install copy. Resume comes later via agent `set_resume` or Settings — as coded today. |
| 5 | **Never auto-submit** | Both clips end on human-in-the-loop payoff — tracker control (A) or “you click submit” (B). |

---

## Style bible (shared)

| Axis | Spec |
|---|---|
| POV | **UI-forward** — product screens, not lifestyle desk shots |
| Mood | Clean digital illustration, dark void, iris accents |
| Hierarchy | Number badge → short caption → UI frame |
| Audio | **Silent explainer · no audio needed** — mute + loop |
| Length | **~21s** each (6 beats, variable hold, 0.9s crossfade), seamless loop |
| Format | 1920×1080 H.264 `.mp4`, poster PNG from title keyframe |
| Brand | Dark intervu UI on-screen (`#12151a` void, iris `#7cb87a`); no purple neon |

**Keyframe comps:** `docs/design/how-it-works-keyframes/`

| File | Beat it locks |
|---|---|
| `intervu-video-a-mcp-keyframe-0-title.png` | A · Title — “Connect Claude to the job market” |
| `intervu-video-a-mcp-keyframe-1-connect.png` | A · Setup — paste MCP URL in Connectors |
| `intervu-video-a-mcp-keyframe-2-approve.png` | A · Setup — OAuth Allow once |
| `intervu-video-a-mcp-keyframe-3-ask.png` | A · Use — prompt in Claude chat |
| `intervu-video-a-mcp-keyframe-4-results.png` | A · Use — verified jobs + save to tracker |
| `intervu-video-a-mcp-keyframe-5-payoff.png` | A · Payoff — “You stay in control” |
| `intervu-video-b-openclaw-keyframe-0-title.png` | B · Title — “Overnight prep on your machine” |
| `intervu-video-b-openclaw-keyframe-1-install.png` | B · Setup — curl one-liner |
| `intervu-video-b-openclaw-keyframe-2-approve.png` | B · Setup — browser OAuth Allow |
| `intervu-video-b-openclaw-keyframe-3-overnight.png` | B · Use — agent runs overnight |
| `intervu-video-b-openclaw-keyframe-4-digest.png` | B · Use — WhatsApp digest + draft resume |
| `intervu-video-b-openclaw-keyframe-5-payoff.png` | B · Payoff — “You always click submit” |

---

## Video A — Claude MCP (~21.3s)

**Job:** Silent explainer — connect Claude via MCP, then show real usage after one-time approve.  
**Hero client:** Claude Desktop (continuous). ChatGPT = caption only: *“Works with ChatGPT too — same connector URL.”*  
**CTA after watch:** Copy `https://intervu.cc/api/mcp` (already on the lane).  
**Post-setup weight:** 15.6s / 21.3s = **73%**

| t | # | Beat | Caption (burned) | UI detail |
|---|---|---|---|---|
| 0.0–3.9s | 1 | **Title** | Connect Claude to the job market | Title card, step badge 1 |
| 3.9–7.5s | 2 | **Setup** | Add connector | Claude Settings → Connectors → URL `https://intervu.cc/api/mcp` (iris valid ring) → Save |
| 7.5–11.1s | 3 | **Setup** | Approve once | OAuth: *Search jobs*, *Save to tracker*, *Never apply without you* → Allow |
| 11.1–14.7s | 4 | **Use** | Ask in chat | User prompt: *“Find senior PM roles in Berlin posted this week.”* |
| 14.7–18.3s | 5 | **Use** | Real jobs · save to tracker | 3 verified roles + “Save to tracker” chips |
| 18.3–21.3s | 6 | **Payoff** | You stay in control | “Never applies without you” + tracker view. Loops to Title. |

**Must show:** connector paste, OAuth approve, ask-in-chat, verified results, tracker save, human control.  
**Must not show:** resume upload, ChatGPT UI, pain/desk montage, auto-apply.  
**End state:** paired + verified jobs saved — user in control.

**Caption (modal, not in video):** “Works with ChatGPT too.”

---

## Video B — OpenClaw (~21.3s)

**Job:** Silent explainer — one install, approve once, then overnight agent + morning review.  
**CTA after watch:** Copy `curl -fsSL https://intervu.cc/install | bash`.  
**Post-setup weight:** 15.6s / 21.3s = **73%**

| t | # | Beat | Caption (burned) | UI detail |
|---|---|---|---|---|
| 0.0–3.9s | 1 | **Title** | Overnight prep on your machine | Title card, step badge 1 |
| 3.9–7.5s | 2 | **Setup** | One command install | `curl -fsSL https://intervu.cc/install \| bash` → Installation complete |
| 7.5–11.1s | 3 | **Setup** | Approve in browser | OAuth beside terminal: *Run job search locally*, *Draft tailored resumes*, *Never apply without you* → Allow |
| 11.1–14.7s | 4 | **Use** | Agent works overnight | Terminal logs: *Scanning…*, *Found 3 matches*, *Tailoring resume…*, *Draft ready* (2:14 AM) |
| 14.7–18.3s | 5 | **Use** | Wake up to drafts | WhatsApp: *“3 roles fit you today”* + draft PDF chip + *“Review and hit submit”* |
| 18.3–21.3s | 6 | **Payoff** | You always click submit | Submit button + shield. Loops to Title. |

**Must show:** curl install, browser OAuth, overnight logs, WhatsApp digest, draft chip, human submit gate.  
**Must not show:** hosted waitlist as install path, auto-submit, resume upload screen, desk fatigue montage.  
**End state:** skill installed + digest waiting for human review.

---

## Differences (lane clarity)

| | A · MCP | B · OpenClaw |
|---|---|---|
| Hero device | Claude chat UI | Terminal → phone |
| Win moment | Verified roles + tracker save | Overnight digest + draft |
| Setup beats | Paste URL + approve (4s) | Curl + approve (4s) |
| Use beats | Ask → results → control (9.5s) | Overnight → digest → submit (9s) |
| Effort signal | Paste URL | One curl |
| Who runs the agent | Claude cloud | Your machine |
| Resume in clip | **None** | Draft chip only (agent output, not upload) |

---

## Production workflow

1. **Keyframe comps** — 6 PNGs per video in `how-it-works-keyframes/` with burned step + caption.
2. **Loop builder** — `./build-loops.sh` in `how-it-works-videos/`:
   - Variable hold per beat (3.9–4.5s; ≥2.5s settled visibility)
   - 0.9s crossfade between beats
   - ffmpeg `drawtext` step badge + caption overlay when libfreetype build available; keyframes carry captions regardless
   - Subtle zoom (max 1.02) — not Ken Burns desk pan
3. **Review pass** — mute playback at 400px modal width; every beat self-explanatory; iris on CTAs; no purple drift.
4. **Deliverables** — `video-a-mcp-loop.mp4`, `video-b-openclaw-loop.mp4`, poster PNGs from title keyframe.
5. **Preview** — open `preview.html` locally.

---

## UI hook (for later — not building in this PR)

On InstrumentDeck when lane is `mcp` or `claw`:

```
[ hint text ]
[ how it works ]   ← quiet text button under the command slab
```

Click → modal with looping muted video + poster. No autoplay with sound. ChatGPT note lives in modal caption for lane `mcp` only.

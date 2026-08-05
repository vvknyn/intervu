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
| 3 | **Production path** | ~~AI keyframe comps + ffmpeg loop builder~~ — **superseded 2026-08-05.** Films are rendered from HTML against the app's own `.dark` tokens (`studio/`), scrubbed frame-by-frame with Playwright and encoded with ffmpeg. Reason: raster keyframes bake every string and radius, so they could not be corrected, could not carry motion, and could not follow `DESIGN-LANGUAGE.md`. Also `ffmpeg` here has no `libfreetype`, so the `drawtext` caption leg was never runnable. |
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
| Length | **21.3s** each (6 beats, hard cuts on a 21300ms clock), seamless loop — frame 0 and the last frame are asserted pixel-identical at build time |
| Format | 1920×1080 H.264 `.mp4`, poster PNG from title keyframe |
| Brand | Governed by `DESIGN-LANGUAGE.md`, dark variant: radius 0, elevation none, `--brand` (`#5EB496` in dark) only on live dots, a valid field ring and the saved mark — never on a headline. The `#7cb87a` in earlier passes is the **light**-mode brand value and was wrong for a dark composition. |

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

The films are code. `studio/` holds the whole pipeline:

| File | Job |
|---|---|
| `extract-tokens.mjs` | lifts `:root` + `.dark` out of `src/app/globals.css` into `tokens.generated.css`, so the films cannot drift from the app |
| `stage.css` | the shared stage — geometry, type scale, device primitives, motion vocabulary |
| `a-mcp.html`, `b-openclaw.html` | one 21300ms CSS timeline each; every delay is absolute film time |
| `render.mjs` | pauses every animation and sets `currentTime` per frame, screenshotting 639 exact frames |
| `build.sh` | tokens → render → encode → poster, plus the loop-seam assertion |

```
./studio/build.sh              # both films
./studio/build.sh a-mcp        # one
node studio/render.mjs a-mcp --probe=7200,10600   # eyeball single moments
```

Deterministic by construction: the same commit produces the same bytes, because
nothing is screen-recorded and no wall-clock time reaches the page.

**Deliverables** — `video-a-mcp.mp4`, `video-b-openclaw.mp4`, `poster-*.png`.
**Preview** — open `preview.html` (includes a 400px modal-width legibility row).

**Motion exception:** `DESIGN-LANGUAGE.md:72` limits the app to 150ms colour
transitions and requires a written reason for anything more. These pages are
frames of a film, not an interactive surface — the reason is recorded at the top
of `stage.css`, and the restraint is kept in the vocabulary (fades, 8-20px
translates, typing, stagger; no bounce, no parallax, the app's own easing).

## UI hook (for later — not building in this PR)

On InstrumentDeck when lane is `mcp` or `claw`:

```
[ hint text ]
[ how it works ]   ← quiet text button under the command slab
```

Click → modal with looping muted video + poster. No autoplay with sound. ChatGPT note lives in modal caption for lane `mcp` only.

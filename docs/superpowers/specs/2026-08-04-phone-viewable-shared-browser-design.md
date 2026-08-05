# Phone-viewable shared browser (v1)

**Date:** 2026-08-04
**Status:** design approved, not implemented
**Owner:** Vivek

## Problem

The OpenClaw apply agent fills out job application forms in a real Chrome window on the
user's laptop. The user has to be at that laptop to see what the agent is doing, review
the filled form, and press Submit. Vivek's ask:

> "as part of the openclaw setup, I want a shared browser that I can view on my phone as
> well... the openclaw agent fills out the form on a browser and I am able to view that
> shared session on my phone... the use case is that as the agent keeps filling out
> apps... I can review them on the go"

Two constraints stated during design:

1. **Invisible setup.** "I want all this setup to be invisible to the user... how can you
   include all this in the setup script?" The existing one-command installer
   (`curl -fsSL https://intervu.cc/install | bash`) must remain one command with no new
   user-facing steps, accounts, logins, or app installs.
2. **Scales by staying local.** "the local setup... scales infinitely... each user has
   their own setup... but I want that setup to be a one click installer and it works like
   magic."

## Goals

- The user opens a link on their phone and watches the agent fill a form, live, from
  anywhere — including cellular.
- Zero new user-facing setup steps.
- Per-user cost to us stays near zero at any number of users.

## Non-goals (v1)

- **No input forwarding.** The phone watches; it cannot tap, type, or submit. Decided by
  Vivek: build watch-only, then look at it on a real form and decide whether the missing
  control is worth adding.
- No recording or replay of sessions.
- No multi-viewer (one phone per session).
- No Android/iOS native app. Mobile Safari/Chrome only.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Watch-only in v1; revisit control after first real use | Smallest build; a leaked link is a window, not a steering wheel |
| D2 | Ship the doorbell (signaling) in v1, not LAN-only | "On the go" is the actual use case; LAN-only does not deliver it |
| D3 | ~~Fit-to-width + pinch zoom on the phone~~ **SUPERSEDED — see D3a** | Simplest; auto-follow-the-active-field deferred until we've seen a real form on a real phone |
| D3a | **The phone crops to the field the agent is filling and follows it** (2026-08-05, after seeing D3 on a real phone) | D3 was falsified by arithmetic, not taste. Measured: the agent's viewport is **1512×861 CSS px** and a phone in portrait is ~390, so fit-to-width renders at **26%** — a 14px label lands under 4px. Landscape only reaches 56%. Cropping to the active field reaches **0.75× (measured live)**, a 2.9× improvement, and is also the right subject: when reviewing a form being filled, the field being filled is what you want to see. A tap toggles back to the whole page for orientation. Viewport emulation stays rejected — it would change the DOM the agent drives |
| D4 | Phone requires normal intervu login | Proper auth; a leaked WhatsApp link is useless to anyone else. One familiar login, our own product's |
| D5 | The doorbell is **free**, not paid tier | Doctrine 4's line is *runtime ownership*. We own no runtime here — browser, compute and every pixel stay on the user's machine. We host an introduction, not a runtime |
| D6 | Media is peer-to-peer, never relayed through our servers | Keeps per-user cost at zero, and makes "we cannot see your screen" true by construction |
| D7 | Viewer follows the tab the agent is currently acting on | The skill runs a two-tab protocol (form tab + resume tab). Following the active page target is the simplest rule that always shows the thing being worked on. The phone displays the tab title so there is never ambiguity about what is on screen |

## Architecture

```
LAPTOP (all compute, all pixels)          intervu.cc            PHONE
┌────────────────────────────┐          ┌──────────┐        ┌─────────┐
│ Chrome   CDP :18800        │          │ doorbell │        │ Safari  │
│    │ Page.startScreencast  │ ①register│ (signal) │        │         │
│    ▼                       │◄────────►│  ~few KB │◄──────►│ /watch  │
│  viewer.mjs                │          └──────────┘   ②    │  /<id>  │
│    └─ transport seam ──────┼───────────────────────────────►  canvas│
└────────────────────────────┘   ③ direct peer-to-peer      └─────────┘
                                    (server has dropped out)
```

① The viewer registers a session with the doorbell, authenticated with the OAuth
credential `mcporter` already holds.
② Phone and laptop exchange connection details through the doorbell.
③ They connect directly. The doorbell is out of the path for the rest of the session.

### Why a data channel rather than a video track

CDP hands us finished JPEGs, so encoding to H.264 would mean decoding and re-encoding for
no benefit. Frames travel as binary messages over a WebRTC data channel and the phone
draws them to a canvas.

Two properties of `Page.startScreencast` carry the performance story:

- It emits a frame **only when pixels change**, so an idle form costs nothing.
- Each frame must be acknowledged (`Page.screencastFrameAck`) before Chrome sends the
  next, so a weak cellular link **self-throttles** instead of building a backlog.

## Components

Each component below is independently testable and depends only on what is listed.

### 1. `FrameSource` (in `openclaw/scripts/viewer.mjs`)

- **Does:** finds the page target the agent is acting on, attaches to it, starts a
  screencast, emits JPEG frames.
- **Interface:** `start()`, `onFrame(cb)`, `stop()`.
- **Depends on:** CDP at `http://127.0.0.1:18800` only.
- **Behaviour:** on tab switch, re-attaches to the new active target. If CDP is
  unreachable, it fails loudly with a message naming the port — it must never stall
  silently (see the "never go silent" rule shipped as intervu #113).

### 2. `Transport` (in `openclaw/scripts/viewer.mjs`)

- **Does:** provides a duplex byte channel to the phone. Nothing above it knows which
  implementation is in use.
- **Interface:** `connect() → channel`, `send(bytes)`, `onMessage(cb)`, `close()`.
- **Implementations, both in v1:**
  - `WebRtcTransport` — via `werift`. The primary path; the only one that works off-WiFi.
  - `LanWebSocketTransport` — automatic fallback when peer-to-peer fails **and** the phone
    is on the same WiFi as the laptop.
- **Depends on:** the doorbell (WebRTC only) and `werift`.

The frame protocol above this seam is byte-identical across implementations. This is what
lets the LAN fallback exist without a second codebase.

**Known v1 coverage gap, stated deliberately:** if peer-to-peer fails *and* the phone is
off the home WiFi, v1 has no fallback. The user gets an explicit "couldn't connect" message
naming the reason — never a blank screen or a hang. Closing that gap is the TURN question
deferred to v2.

### 3. `viewer.mjs` (entry point)

- **Does:** wires `FrameSource` → `Transport`, registers the session, prints the watch URL
  on stdout, and owns the session lifecycle.
- **Depends on:** components 1 and 2.
- **Lifecycle:** started by the skill when form-filling begins, stopped at handoff. No
  idle listener sits open outside an active application.

### 4. `POST /api/viewer/session` (intervu.cc)

- **Does:** the doorbell. Registers a session, returns a session id, carries connection
  details between the two devices. Carries no media.
- **Depends on:** the same OAuth verification `/api/mcp` already uses.
- **Constraints:** session id is unguessable, short-TTL, bound to the owning account, and
  invalidated at handoff.

### 5. `/watch/[id]` (intervu.cc)

- **Does:** the page mobile Safari loads. Authenticates the user, establishes the peer
  connection, draws frames to a canvas, fits to width.
- **Depends on:** existing Firebase auth; the doorbell.
- **v1:** renders frames and nothing else. No input handlers.

### 6. SKILL.md hook

- **Does:** at the start of the FORM FILL phase, starts the viewer and sends the watch
  link over WhatsApp (the same mechanism that already delivers the resume PDF). Stops the
  viewer at handoff.

## Security and privacy

- **We cannot see the screen.** WebRTC media is encrypted between the two devices. "The
  user's live browser transits our servers" is false by construction, not by policy.
- **The form on screen contains personal data** — address, phone number, work history — so
  even watch-only is treated as sensitive: unguessable session id, short TTL, account
  binding, login required on the phone (D4), and the session dies at handoff.
- **v1 forwards no input**, so a leaked link exposes a view, not a remote control. That
  gate becomes materially more serious the day control is added; revisit D4 and the TTL at
  that point.

## What ships where

| Piece | Installer delta |
|---|---|
| `openclaw/scripts/viewer.mjs` | none — prebuild is exclude-based, new files under `openclaw/` package automatically |
| Node runtime | none — v22.20.0 already required by OpenClaw |
| CDP access | none — port 18800 already listening, no Chrome flag needed |
| Link delivery | none — WhatsApp already paired |
| `openclaw/SKILL.md` step | none — SKILL.md already ships |
| `werift` dependency | **one new dependency** — `install.sh` runs `npm install --prefix` on the skill dir immediately after extracting the tarball |
| intervu.cc routes | standard deploy |

The dependency is installed by the installer rather than vendored into the tarball: the
installer already runs `npm i -g` twice (for OpenClaw and mcporter), so npm is a proven
part of the flow, and this keeps the tarball small. It must run **after** extraction,
because skill install is rm-then-cp and would otherwise wipe `node_modules`.

`install.sh` stays at 8 user-facing steps. Nothing new is installed by hand, approved, or
logged into. The dependency is the only real delta and it is invisible to the user — so
the accurate claim is **zero user-visible installer delta**, not zero delta.

## Verified facts vs assumptions

Verified on Vivek's machine, 2026-08-04:

- OpenClaw 2026.3.8 drives **real Google Chrome** (not headless):
  `detectedPath: /Applications/Google Chrome.app/...`
- **CDP is live** at `127.0.0.1:18800` — Chrome 150.0.7871.188, protocol 1.3, browser-level
  WebSocket debugger URL present.
- **Node v22.20.0** already installed.
- `install.sh` is 168 lines / 8 steps, idempotent, `curl | bash`, no repo checkout.
- OpenClaw's Control UI (`:18789`) is chat/nodes/config only — there is **no** built-in
  browser view, so this has to be built.
- `werift@0.24.3` — `engines: node >=16`, dependency tree is pure JavaScript
  (`@noble/curves`, `tweetnacl`, `@peculiar/x509`, …), **no `node-gyp`**.

Assumptions, explicitly not verified:

- `werift` has been checked by **package metadata only** — it has not been executed. If it
  fails in practice, `node-datachannel@0.32.3` is the fallback, but it is a native module
  and would reintroduce a compile step, which would break the invisible-install property.
- Peer-to-peer fails on some restrictive networks. The commonly cited figure is roughly
  10–20% of connections; **this is an industry rule of thumb, not a measurement of our
  users.** The LAN transport is the v1 fallback; a TURN relay is a v2 question and must not
  live on the Contabo box.

## Rejected alternatives

- **Tailscale.** Already installed on Vivek's machine and would work for him personally,
  but `tailscale up` requires an interactive third-party login and a phone-side app
  install. Cannot be invisible in a `curl | bash`.
- **Cloudflare quick tunnel.** Genuinely zero-config and zero-cost, and scales fine on
  capacity since each tunnel runs on its own user's laptop. Rejected on **correlated
  failure**: all users depend on one third party's policy, so a single rate-limit or block
  takes the feature to zero for everyone at once, with no SLA and no per-user identity to
  measure the damage.
- **WebSocket relay through intervu.cc.** Simplest to build, worst to run: it is a
  long-lived stream that would contend with the scraping pipelines on a box already
  established as CPU-bound. Also puts users' live browser pixels through our servers.
- **UPnP / router port mapping.** Genuinely broker-free, but carrier-grade NAT defeats it
  regardless of configuration, many routers ship with UPnP disabled, home public IPs move,
  and it means opening a hole from the internet into a user's home network. Not acceptable
  in a one-click installer.
- **Switching Chrome to a mobile device profile** so ATS forms render in their own mobile
  layout. Visually far better on a phone, but it changes the DOM the agent is driving, and
  `form-audit.js` plus the agent's element refs were built against the desktop layout.
  Rejected as too risky for the agent's correctness.

## Testing

Component tests:

- `FrameSource` against a stub CDP WebSocket: frame emission, ack backpressure, tab-switch
  re-attach, loud failure when port 18800 is closed.
- `Transport`: `LanWebSocketTransport` in-process; `WebRtcTransport` via a loopback peer
  pair.
- Doorbell route: auth required, session TTL honoured, ownership binding enforced,
  invalidation at handoff.

**End-to-end is mandatory, not optional.** The `file:` protocol defect (intervu #114) passed
every component test and was only exposed by running the whole loop; the same discipline
applies here. E2E means: run the real agent against a real ATS form and open the link on an
actual phone, on cellular, off the home WiFi.

## Implementation findings (v1, 2026-08-05)

Three defects found only by running it on a real phone. All three share one
root property worth stating once, because it will bite again:
**`Page.startScreencast` emits only when pixels change.**

1. **Blank on a still page.** A form that has finished rendering emits nothing
   at all (measured: 0 frames in 5s static, 1 the instant a pixel moved). The
   efficiency property and the bug are the same fact. Fixed as a rule — *any
   subscriber, connecting at any time, immediately receives the current
   screen* — via a `Page.captureScreenshot` on start plus a retained last
   frame replayed to each new subscriber. That also closed a second, unreported
   instance: SSE has no replay, so a late-joining phone saw nothing either.
2. **Stuck full-page after focus is discovered.** Same root property: with no
   new frame coming, learning the focused field later never reaches the phone.
   A focus change re-publishes the last frame.
3. **Page never started.** A browser resolves the page's `./crop.mjs` import
   with no query string, so a module request cannot carry the viewer token;
   the 403 killed the whole module script silently. Static assets are now
   served ahead of the token gate — the token protects the screen, not
   arithmetic. `/favicon.ico` answers 204 for the same reason.

**Process note:** all three passed unit tests. A test that speaks the protocol
is not a test that loads the page — browser-facing changes must be opened in a
real browser before being called done.

## Deferred to v2

- Input forwarding (tap, type, submit) and the harder auth gate it requires.
- ~~Auto-follow of the active form field~~ — **pulled into v1**, see D3a.
- Crop geometry (520px floor, 100px padding, 1.2 aspect) is unmeasured
  judgement; tune against a real ATS form.
- The initial `captureScreenshot` ignores the 1280px cap `startScreencast`
  honours, so the first frame is ~45 KB against ~10–15 KB for deltas. Matters
  for the cellular path.
- The LAN port is fixed at 18801; two concurrent applications would collide.
- TURN relay for networks where peer-to-peer fails — explicitly **not** on the Contabo box.
- Metering seam in the doorbell, should D5 ever be revisited.

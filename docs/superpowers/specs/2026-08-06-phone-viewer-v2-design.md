# Phone viewer v2 — control, resilience, watch-from-anywhere

**Date:** 2026-08-06
**Status:** design approved (brainstormed with Vivek, Aug 6 00:05–00:17 EDT), not implemented
**Owner:** Vivek
**Builds on:** `2026-08-04-phone-viewable-shared-browser-design.md` (v1, shipped as intervu #126–#132, live-verified on a real phone Aug 5 23:40)

## Problem

v1 shipped watch-only and WiFi-verified. One night of real use surfaced four failures, each felt live:

1. **Watch-only frustrates at review time.** "Clickable things do not work" — the whole point
   is reviewing on the go, and review means occasionally fixing.
2. **Cellular does not work.** Wire-proof, twice: ICE 32 B in / 480 B out on mobile data —
   with the laptop's VPN on *and* off. Carrier CGNAT is unpunchable; the VPN-confound theory
   is dead. (Same signature both nights; TELUS Mobility on the phone side.)
3. **Sessions are one-shot and fragile.** The host reads the guest slot once, so a closed or
   reloaded phone tab strands the session ("regenerate a new session… this is so painful").
   Separately, in-RAM server sessions die on every deploy — and parallel sessions deployed
   intervu twice in 25 minutes on Aug 5, killing live tests both times.
4. **Dead links lie.** An expired watch link hangs at "connecting…" instead of saying it's dead.

## Facts established Aug 5–6 (verified, not assumed)

- The phone HAS a global IPv6 address on cellular (`2001:56b:…`, TELUS Mobility, seen in its
  SDP); the laptop has none (router hands out no IPv6). Address-family mismatch → werift's
  IPv6 gathering can't help. Router IPv6 remains a *possible* future direct path — untested.
- **The tailnet link works over cellular, today, with zero code changes.** Phone joined
  Vivek's tailnet and held an ESTABLISHED SSE connection to `http://100.111.232.96:18801/?t=…`
  (verified via lsof, Aug 6 00:02). It also **survives tab closes** — SSE reconnect + the v1
  replay-on-connect rule already cover it.
- `transport-lan.mjs:40` already computes a URL for **every** non-internal interface —
  including the tailnet one — and `start()` (`:126`) returns only `[0]`. The tailnet URL is
  being computed and thrown away.
- The viewer's server binds `*:18801` with token-only auth, so serving over the tailnet
  interface requires no server change.

## Decisions (numbering continues from v1)

| # | Decision | Rationale |
|---|---|---|
| D8 | **Tap + type** control from the phone; per-session "take control" toggle, **off by default** | Completes "review and correct on the go" without shipping a full remote. D1's watch-only stance is revised, not discarded: control is a second gate on top of D4's login, never a property of the link |
| D9 | **Cellular = Tailscale, friction engineered away.** Offered just-in-time through the messenger the user already paired with OpenClaw — channel-agnostic, nothing hardcoded to WhatsApp. Laptop configures itself; every human step happens on the phone | Keeps D6 absolute — no frame ever transits infrastructure we run, hard-NAT cases ride Tailscale's own E2E-encrypted relays. Rejected: self-hosted coturn (revises D6; v1 said no TURN on the CPU-bound box) and relay-default layering (same, plus biggest build). The v1 rejection of Tailscale was about *mandatory invisible* setup; an *optional, explicit* upgrade is a different thing |
| D10 | Doorbell sessions move behind the existing `session-store.ts` seam to a **bind-mounted JSON file** | Survives container replacement (the Aug 5 deploy-kill class). Doctrine holds: same ≤15-min signaling blobs, TTL-swept, transient-surviving-a-deploy ≠ durable |
| D11 | The doorbell stops being one-shot: **guests may re-answer; the host renegotiates on a changed answer** under the same session id | Reconnect for the WebRTC path; brings it to parity with the tailnet link's behavior |
| D12 | Skill link ladder: `WATCH-ANYWHERE` (tailnet, only once setup is **verified**) > `WATCH` (doorbell) > `WATCH-LAN`. Still exactly one link per message | One link stays the rule; the ladder just picks the best one the user's setup has earned |

## Section A — Watch from anywhere (Tailscale path)

The Apple move: **the entire ritual happens on the phone.** `tailscale up` emits an auth URL
openable on any device, so the laptop configures itself and the user never walks over to it.

Flow:

1. Viewer startup prints every reachable link, labeled: `WATCH:`, `WATCH-LAN:`, and — when a
   tailnet interface exists — `WATCH-ANYWHERE:` (stop discarding what `lanUrls` computes;
   tailnet interface identified by the 100.64.0.0/10 address range).
2. The skill sends one link, chosen by the D12 ladder.
3. **JIT offer:** first watch link ever sent, no tailnet setup present → the message carries
   one extra line: *"Off WiFi? A one-time 2-minute setup makes this link work from anywhere —
   reply `setup` when you want it."* Sent over the paired messenger, whichever it is.
4. On the explicit `setup` reply — never silently — the agent runs the laptop side: install
   Tailscale (brew on macOS, the official script on Linux; skip if present), `tailscale up`,
   and texts the auth URL to the phone. The user taps it, signs in (account created if new) —
   the laptop joins the tailnet. One more message: app-store link + "sign in with the same
   account." The phone joins.
5. **Completion is verified, not assumed:** the laptop watches `tailscale status` until a
   mobile peer comes online, then writes a local marker file. Only then does the ladder
   prefer `WATCH-ANYWHERE`. If verification never lands, nothing changes.

Failure honesty: a tailnet link that cannot connect renders "can't reach your laptop — check
Tailscale is on, or use the home-WiFi link," never a hang.

## Section B — Input forwarding (tap + type)

**Wire.** Input rides the channels frames already use. The WebRTC data channel is duplex; the
LAN/tailnet transport gains one upstream endpoint, `POST /input?t=<token>`, behind the same
token gate as the stream. Three message shapes, versioned JSON:
`{v:1, type:"tap", fx, fy}` (frame pixels), `{v:1, type:"text", insert:"…"}`, and
`{v:1, type:"key", key:"Enter"|"Tab"}` — Enter and Tab are the only special keys.

**Coordinates.** The phone already holds everything needed to invert its own rendering
(frame, crop rect `r`, device width `dw`): canvas point → crop offset → frame pixels. The
host does the final frame→device scaling and injects via CDP `Input.dispatchMouseEvent`
(down+up). Only the host knows the live viewport, so the protocol stays stable if D3a's crop
math changes.

**Typing.** A tap forwards the click *and* focuses a hidden input on the watch page,
summoning the keyboard. Text is forwarded as **deltas** (`Input.insertText`) — autocorrect,
emoji, and paste work with no keymap to maintain.

**One new component, one chokepoint:** `scripts/viewer/input-sink.mjs` — validates input
messages, maps coordinates, injects via CDP. Both transports feed it; neither knows CDP.

**Security — D1 revised, D4 unchanged.** Control rides the same authenticated session
(intervu login, account binding, unguessable id, 15-min TTL, dies at handoff) plus the
off-by-default "take control" toggle; the host discards input until the toggle's enable
message arrives. A leaked link is still a login wall; a hijacked view still can't steer.

**Stated limitation:** user taps while the agent is mid-action → both drive one browser,
last event wins. The real flow makes collisions rare (the agent fills, then invites review);
v2 builds no agent-pausing machinery.

## Section C — Resilience

**Reconnect.** Guest re-POSTs a fresh answer any time within TTL — the server already
permits this (`session-store.ts:56` is a plain overwrite; verified). The host change is to
keep polling and treat a *changed* answer as "negotiate again," building a new peer
connection under the same id.
Phone mirror: on connection drop, the watch page re-fetches the offer and re-answers.

**Honest dead links.** `/watch/[id]` for an unknown/expired session renders: *"This session
has ended. The newest message in your chat has the current link."* Each watch message states
it replaces earlier ones — old messages can't be unsent (channel-agnostic constraint), but
every link can be honest about its mortality.

**Deploy-proof sessions.** The in-RAM Map becomes a bind-mounted JSON file behind the
existing `session-store.ts` interface; compose volume added at
`/opt/interview-os/deploy/contabo-web` (interview-os repo). TTL sweep unchanged.
Single-container remains the deployment truth — the file store is not a multi-instance
answer (that day is still Redis).

**Also in:** the tap-to-zoom label renders only when a crop is actually active (today it
lies on listing pages where crop is a no-op).

## What ships where

| Piece | Change |
|---|---|
| `openclaw/scripts/viewer.mjs` | print labeled links for all interfaces; wire input-sink |
| `openclaw/scripts/viewer/transport-lan.mjs` | return all URLs labeled; `POST /input`; control state |
| `openclaw/scripts/viewer/transport-webrtc.mjs` | reconnect loop; input messages on the data channel |
| `openclaw/scripts/viewer/input-sink.mjs` | **new** — validation, coordinate mapping, CDP injection |
| `openclaw/scripts/viewer/tailnet.mjs` | **new** — detect / setup runner / verify + marker file |
| `/watch/[id]` page + canvas | tap capture + inversion, hidden input, control toggle, re-answer on drop, ended-page copy |
| `src/lib/viewer/session-store.ts` | file-backed store behind the same interface |
| `openclaw/SKILL.md` | D12 ladder, JIT offer copy, setup flow, control etiquette |
| `deploy/contabo-web` compose (interview-os repo) | volume mount for the session file |
| intervu.cc guide page | phone-side Tailscale steps, linked from the JIT offer |

## Non-goals (v2)

Scroll/gesture forwarding (auto-follow owns the viewport) · multi-viewer · TURN in any form ·
the 45 KB first-frame optimization (tailnet makes it moot where it mattered) · crop-geometry
retuning · the fixed-port 18801 two-concurrent-applications collision · agent-pause machinery.

## Testing

- **Unit:** coordinate round-trip through crop math; doorbell re-answer accepted and host
  renegotiates; file-store restart survival; link-ladder choice; input-sink rejects
  malformed/oversized/pre-toggle messages.
- **Loopback e2e:** tap+type injected end-to-end against a second werift peer.
- **Real-device, mandatory (the v1 lesson, three times over):** a real phone on cellular via
  the tailnet, tapping and typing into a real ATS form; one deploy mid-session to prove the
  session file survives; one tab-close/reopen on the doorbell path to prove D11.
- **security-pass skill before ship** — control changes the threat model (D1 revision), and
  the setup flow has the agent installing software on an explicit user reply.

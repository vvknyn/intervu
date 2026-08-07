# Phone Viewer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap+type control from the phone, Tailscale watch-from-anywhere, reconnect-instead-of-strand, deploy-proof doorbell sessions, honest dead links — per `docs/superpowers/specs/2026-08-06-phone-viewer-v2-design.md` (D8–D12).

**Architecture:** All laptop-side code stays under `openclaw/scripts/viewer/`; all server/phone-page code stays under `src/`. One new chokepoint (`input-sink.mjs`) receives every input message from every transport and is the only file that speaks CDP `Input.*`. One new pure module (`input-capture.mjs`) owns coordinate inversion and is shared by both watch UIs the same way `crop.mjs` already is (served static by the LAN transport, relative-imported by `watch-canvas.tsx`).

**Tech Stack:** Node 22, plain `node:http` + `werift@0.24.3` (no new dependencies), Next App Router, vitest.

## Global Constraints

- Worktree: `/Users/vivek/Antigravity/Code/intervu-viewer-v2` (branch `feat/viewer-v2`). Never commit on main.
- **Do NOT run `git commit`** — two agents share this worktree; the orchestrator commits after review. Leave changes in the working tree.
- Test runner: `./node_modules/.bin/vitest run <file>` (never `npx vitest`). Suites: `npm run test:viewer`, `npm run test:agent` must stay green.
- Lean-code rules: SOLID at the seams, smallest complete diff, never gate by enumerating names, no lying fallbacks. Match surrounding comment style (comments explain *why*, never narrate the diff).
- Input wire contract (exact, all transports):
  `{v:1, type:"tap", fx:number, fy:number, fw:number, fh:number}` ·
  `{v:1, type:"text", insert:string}` (≤2000 chars) ·
  `{v:1, type:"key", key:"Enter"|"Tab"}` ·
  `{v:1, type:"control", on:boolean}`.
  `fx,fy` are frame pixels; `fw,fh` are the frame's pixel dimensions as the phone decoded them. The host computes device coords as `fx * dw / fw` (uniform scale; `dw` is the device CSS width it already publishes).
- Tailnet detection = an interface with an IPv4 in 100.64.0.0/10. Verified-setup marker file: `~/.openclaw/viewer-tailnet-ready`.
- Viewer stdout labels (the skill greps these exactly): `WATCH-ANYWHERE:`, `WATCH:`, `WATCH-LAN:`, `SETUP-OFFER: tailnet` (last one printed only when no marker file exists).

## File Structure

| File | Responsibility | Track |
|---|---|---|
| `openclaw/scripts/viewer/input-sink.mjs` (new) | validate input msgs, gate on control toggle, map coords, inject via CDP | A |
| `openclaw/scripts/viewer/input-capture.mjs` (new) | pure inversion: canvas tap → frame point; shared by both watch UIs | A |
| `openclaw/scripts/viewer/transport-lan.mjs` | labeled URLs for every interface; `POST /input`; feed sink | A |
| `openclaw/scripts/viewer/transport-webrtc.mjs` | duplex channel → sink; host-side reconnect loop | A |
| `openclaw/scripts/viewer/tailnet.mjs` (new) | detect / setup / verify+marker; CLI entry | A |
| `openclaw/scripts/viewer/watch-page.html` | tap+type UI for the LAN/tailnet path | A |
| `openclaw/scripts/viewer.mjs` | print labeled links; wire sink into transports | A |
| `openclaw/SKILL.md` | D12 ladder, JIT offer, setup flow, control etiquette | A |
| `src/lib/viewer/session-store.ts` | file-backed store behind unchanged interface | B |
| `src/components/viewer/watch-canvas.tsx` | tap+type UI, control toggle, guest reconnect, ended copy | B |
| `src/app/watch/anywhere/page.tsx` (new) | phone-side Tailscale guide | B |

Cross-track dependency: B consumes `input-capture.mjs` and the wire contract — both fully specified here so the tracks never need to read each other's diffs.

---

### Task A1: `input-capture.mjs` — pure inversion module

**Files:**
- Create: `openclaw/scripts/viewer/input-capture.mjs`
- Test: `tests/unit/viewer-input-capture.test.ts`

**Interfaces:**
- Produces: `frameTapMessage({cssX, cssY, cssWidth, crop, imageWidth, imageHeight})` → the tap message object or `null` (tap landed outside the frame). `crop` is `{sx,sy,sw,sh}` or null — the exact object `computeCrop` returns. Also `textMessage(insert)`, `keyMessage(key)`, `controlMessage(on)` — trivial builders so every producer emits identical shapes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/viewer-input-capture.test.ts
import { describe, expect, it } from "vitest";
import { frameTapMessage, textMessage } from "../../openclaw/scripts/viewer/input-capture.mjs";

describe("frameTapMessage", () => {
    it("maps an uncropped tap through css→frame scaling", () => {
        // canvas is the whole 1000px-wide frame rendered at 500 css px
        const m = frameTapMessage({ cssX: 100, cssY: 40, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 });
        expect(m).toEqual({ v: 1, type: "tap", fx: 200, fy: 80, fw: 1000, fh: 600 });
    });
    it("offsets by the crop origin when cropped", () => {
        const crop = { sx: 300, sy: 120, sw: 400, sh: 300 };
        // canvas shows the 400px-wide crop at 200 css px → scale 2
        const m = frameTapMessage({ cssX: 50, cssY: 30, cssWidth: 200, crop, imageWidth: 1000, imageHeight: 600 });
        expect(m).toEqual({ v: 1, type: "tap", fx: 400, fy: 180, fw: 1000, fh: 600 });
    });
    it("returns null for a tap outside the frame", () => {
        expect(frameTapMessage({ cssX: 9999, cssY: 0, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 })).toBeNull();
    });
    it("builds a text message", () => {
        expect(textMessage("hi")).toEqual({ v: 1, type: "text", insert: "hi" });
    });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `./node_modules/.bin/vitest run tests/unit/viewer-input-capture.test.ts` → module not found.

- [ ] **Step 3: Implement**

```js
// openclaw/scripts/viewer/input-capture.mjs
/**
 * Turns a tap on the watch canvas into a frame-pixel point.
 *
 * Pure and served the same way as crop.mjs so the WebRTC page and the
 * LAN page share one inversion — the two UIs must not drift apart on
 * arithmetic. The phone reports frame pixels plus the frame's own
 * dimensions; only the laptop knows the live device width, so the final
 * frame→device scaling happens there (input-sink.mjs).
 */
export function frameTapMessage({ cssX, cssY, cssWidth, crop, imageWidth, imageHeight }) {
    const view = crop ?? { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };
    const scale = view.sw / cssWidth;
    const fx = Math.round(view.sx + cssX * scale);
    const fy = Math.round(view.sy + cssY * scale);
    if (fx < 0 || fy < 0 || fx > imageWidth || fy > imageHeight) return null;
    return { v: 1, type: "tap", fx, fy, fw: imageWidth, fh: imageHeight };
}

export const textMessage = (insert) => ({ v: 1, type: "text", insert });
export const keyMessage = (key) => ({ v: 1, type: "key", key });
export const controlMessage = (on) => ({ v: 1, type: "control", on });
```

- [ ] **Step 4: Run the test, confirm green.** Do not commit (orchestrator commits).

### Task A2: `input-sink.mjs` — the one place input becomes CDP

**Files:**
- Create: `openclaw/scripts/viewer/input-sink.mjs`
- Test: `tests/unit/viewer-input-sink.test.ts`

**Interfaces:**
- Consumes: the wire contract (Global Constraints).
- Produces: `createInputSink({ send, deviceWidth })` where `send(cdpMessage)` posts a CDP command (the same injected-send pattern `frame-pump.mjs` uses — read it first) and `deviceWidth()` returns the current device CSS width or null. Returns `{ handle(text) }` — `text` is the raw JSON string from any transport. Control state lives inside: input messages are **dropped until** `{type:"control", on:true}` arrives; `on:false` re-arms the gate.

- [ ] **Step 1: Read `openclaw/scripts/viewer/frame-pump.mjs`** to copy its CDP-send conventions (id handling, method/params shape).

- [ ] **Step 2: Write the failing test** — cover, with a recording `send` stub: (a) tap before control-on is dropped; (b) after control-on, `{tap, fx:200, fy:80, fw:1000, fh:600}` with `deviceWidth()=1512` emits `Input.dispatchMouseEvent` mousePressed then mouseReleased at `x: Math.round(200*1512/1000)`, `y: Math.round(80*1512/1000)`, `button:"left"`, `clickCount:1`; (c) text emits `Input.insertText`; (d) `key:"Enter"` emits `Input.dispatchKeyEvent` rawKeyDown then keyUp with `key:"Enter", code:"Enter", windowsVirtualKeyCode:13` (Tab → 9); (e) malformed JSON, wrong `v`, unknown type, `insert` >2000 chars, non-finite numbers are all dropped silently — the sink must never throw; (f) `deviceWidth()` null drops taps (no scale exists) but text still flows.

- [ ] **Step 3: Implement minimally.** Validation is structural (shape + types + bounds), never an allowlist of senders. ~60 lines.

- [ ] **Step 4: Green.** No commit.

### Task A3: LAN transport — labeled URLs, `POST /input`, duplex

**Files:**
- Modify: `openclaw/scripts/viewer/transport-lan.mjs`
- Modify: `openclaw/scripts/viewer/watch-page.html`
- Test: extend `tests/unit/viewer-frame-source.test.ts` siblings — find the existing transport-lan tests first (`grep -rl transport-lan tests/`).

**Interfaces:**
- Produces: `lanUrls` gains a label: returns `[{ kind: "tailnet"|"lan", url }]` — `kind:"tailnet"` when the address is in 100.64.0.0/10 (test `100.64.0.0`, `100.111.232.96`, `100.127.255.255` in; `100.63.x`/`100.128.x`/`192.168.x` out). `start()` returns `{ urls }` (all of them, labeled) instead of `{ url }`. `createLanTransport({ port, token, onInput })` — every valid-token `POST /input` body line is passed to `onInput(text)` verbatim; the endpoint answers 204 and never parses (parsing is the sink's job).
- Consumes: `input-capture.mjs` (served static exactly like `crop.mjs` — same no-token-gate rationale, copy the comment pattern) for `watch-page.html`.

- [ ] Steps: failing tests for the label classifier and the `/input` route (token-gated: wrong token → 403; valid → 204 + `onInput` called) → implement → extend `watch-page.html`: tap listener on the canvas calls `frameTapMessage` with its current crop state and POSTs to `/input?t=<token>`; a fixed-position "take control" button toggles (sends `controlMessage`, flips label to "watching only"); hidden `<input>` focused on tap-in-control-mode, its `input` events POST `textMessage` deltas, Enter/Tab keydown POST `keyMessage`. Follow the page's existing inline-style conventions.
- [ ] Update `viewer.mjs` call site in the same pass (it destructures `{ url }` today — `viewer.mjs:36-38`): print `WATCH-LAN:` for the first `kind:"lan"` url, and `WATCH-ANYWHERE:` for the first `kind:"tailnet"` url **only when** `~/.openclaw/viewer-tailnet-ready` exists (import the check from `tailnet.mjs`, Task A5); when a tailnet url exists but no marker, print `SETUP-OFFER: tailnet` instead. Construct the sink in `viewer.mjs` with `deviceWidth: () => focus.dw` and pass `onInput: (text) => sink.handle(text)` to both transports.
- [ ] Full suite green: `npm run test:viewer`. No commit.

### Task A4: WebRTC transport — duplex + host reconnect

**Files:**
- Modify: `openclaw/scripts/viewer/transport-webrtc.mjs`
- Test: extend `tests/unit/viewer-signal-client.test.ts` and `tests/unit/viewer-webrtc-loopback.test.ts`

**Interfaces:**
- Produces: `createWebRtcTransport({ apiBase, bearer, fetchImpl, onInput })`. Incoming data-channel messages that do **not** start with `"C"`/`"F"` framing are input JSON → `onInput(text)`. (Input messages are small; they are never chunked. Frames only ever flow laptop→phone, so the direction disambiguates, but parse by prefix, not direction.)
- Reconnect (D11): extract the offer/POST/poll sequence into an internal `negotiate(previousAnswerSdp)` that ignores a guest answer whose sdp equals `previousAnswerSdp` (poll predicate — extend `pollUntilGuest` with an optional `ignoreSdp` option rather than a second polling loop). On `channel.onclose` or `pc.connectionStateChange` ∈ {failed, closed, disconnected}, and while the session's `expiresAt` is in the future: tear down the pc, run `negotiate` again with a **fresh offer** (the guest re-fetches and answers the new offer — putSignal overwrites are verified server behavior, `session-store.ts:56`). Replay-on-open already exists (`channel.onopen`) and covers the new channel.

- [ ] Steps: failing test — `pollUntilGuest` with `ignoreSdp` skips the stale answer then accepts a changed one → implement → loopback test: kill the answering peer's channel, stand up a second peer, assert a frame arrives on the new channel and that an input message sent guest→host reaches `onInput` → green. No commit.

### Task A5: `tailnet.mjs` — detect / setup / verify

**Files:**
- Create: `openclaw/scripts/viewer/tailnet.mjs`
- Test: `tests/unit/viewer-tailnet.test.ts`

**Interfaces:**
- Produces: `isTailnetAddress(ip)` (the 100.64/10 predicate A3 imports), `tailnetReady()` (marker file exists), `MARKER_PATH`. CLI: `node scripts/viewer/tailnet.mjs setup` → installs if missing (`brew install tailscale` on darwin, `curl -fsSL https://tailscale.com/install.sh | sh` otherwise; skip when `tailscale` is on PATH), spawns `tailscale up`, scrapes the auth URL from its output and prints it as `TAILNET-AUTH-URL: <url>` (the skill forwards that line to the phone), then polls `tailscale status --json` until a peer with `"OS": "iOS"|"android"` is `Online`, writes the marker, prints `TAILNET-READY`. A 10-minute ceiling, then `TAILNET-TIMEOUT` and exit 1 — never a silent hang.
- All shell-outs go through an injected `run` function so tests never execute real commands.

- [ ] Steps: failing tests (address predicate edges; setup flow against a scripted `run` stub: already-installed path, auth-url scrape, marker written only after a mobile peer is Online) → implement → green. No commit.

### Task A6: SKILL.md — ladder, JIT offer, setup flow, control etiquette

**Files:**
- Modify: `openclaw/SKILL.md` (the viewer step, currently ~line 373, and the handoff step ~line 487)

- [ ] Rewrite the watch step: send exactly one link — `WATCH-ANYWHERE:` if printed, else `WATCH:`, else `WATCH-LAN:`. If `SETUP-OFFER: tailnet` was printed AND this is the first watch link this session, append the one JIT line: *"Off WiFi? A one-time 2-minute setup makes this link work from anywhere — reply `setup` when you want it."* On a `setup` reply: run `node scripts/viewer/tailnet.mjs setup`, forward the `TAILNET-AUTH-URL:` line with *"Tap this and sign in — your laptop is joining your private network"*, then on `TAILNET-READY` send the app-store step: *"Last step: install the Tailscale app on this phone and sign in with the same account."* Never install anything without the explicit `setup` reply. Add one line to the review-invitation message: *"Tap 'take control' on the watch page to fix anything directly."* Keep the existing stop-the-viewer-at-handoff step (`SKILL.md:487`) — control dies with it.
- [ ] `npm run test:agent` green (it lints SKILL.md structure). No commit.

### Task B1: file-backed session store

**Files:**
- Modify: `src/lib/viewer/session-store.ts`
- Test: `tests/unit/viewer-session-store.test.ts` (create if absent — check first)

**Interfaces:**
- Exported signatures unchanged (`createSession`, `getSession`, `putSignal`, `deleteSession` — all stay async). Behavior delta only: when `process.env.VIEWER_SESSION_FILE` is set, the Map is loaded from that JSON file at first touch and every mutation rewrites it atomically (write `<file>.tmp`, `renameSync` over — a torn write must not eat the store). Unset env → exactly today's in-memory behavior (dev/test unchanged, no lying fallback: the file path is either configured or the feature is off).

- [ ] Steps: failing test — two store "instances" (reset the `globalThis` key between requires, point both at one temp file): a session created by the first is visible to the second after simulated restart; expired sessions swept on create are also gone from the file; unset env never touches disk → implement (~40 lines: `loadFromFile`, `persist` called by the three mutators) → green. No commit.

### Task B2: watch page — tap+type UI, control toggle, guest reconnect, honest ended copy

**Files:**
- Modify: `src/components/viewer/watch-canvas.tsx`
- Test: extend the existing watch-canvas tests (`grep -rl watch-canvas tests/`)

**Interfaces:**
- Consumes: `input-capture.mjs` via the same relative import `crop.mjs` already uses (`watch-canvas.tsx:4`), and the data channel (keep a `channelRef` from `ondatachannel`).
- Behavior:
  - **Ended copy:** the `!res.ok` branch (`watch-canvas.tsx:98`) becomes *"This session has ended. The newest message in your chat has the current link."*
  - **Control toggle:** a header button ("take control" / "watching only"), default off, sends `controlMessage(on)` over the channel. The existing whole-`<main>` click toggles zoom — scope that handler to the canvas only when control is OFF; when control is ON, canvas taps become `frameTapMessage` sends (using `latestRef.current` for crop/img dims) and zoom moves to the header status chip.
  - **Type:** in control mode, a visually-hidden `<input>` is focused after each tap; `onInput` sends `textMessage` deltas (clear the input after send), Enter/Tab `onKeyDown` send `keyMessage` and prevent default.
  - **Guest reconnect (D11):** `pc.onconnectionstatechange` → on failed/disconnected/closed, loop: re-fetch the offer until its sdp differs from the one this pc answered, then build a fresh pc and re-answer. Reuse the existing join loop by restructuring it into a `join(previousOfferSdp)` function invoked by both mount and reconnect. Status line during: "reconnecting…".

- [ ] Steps: failing tests for ended copy, control-off tap = zoom toggle + no send, control-on tap = channel send with correct payload (mock channel), reconnect re-answers only a *changed* offer → implement → `npm run test:viewer` green. No commit. **Class rule from memory: modal/aria — use test-ids, not getByRole, in these tests.**

### Task B3: `/watch/anywhere` guide page

**Files:**
- Create: `src/app/watch/anywhere/page.tsx`

- [ ] Static page, same dark visual language as the watch page (bg-black, white text, max-w-sm centered). Content: what this is (one paragraph — "watch from anywhere runs over your own private network; nothing passes through intervu"), the two phone steps (install Tailscale app → sign in with the same account your agent shows you), and "your agent walks you through it — reply `setup` to it whenever you're ready." No marketing voice; plain-language register. Verify it renders: `npm run build` compiles the route. No commit.

### Task C1: compose volume (interview-os repo — separate dispatch)

**Files:**
- Modify: `deploy/contabo-web/docker-compose.yml` (in the **interview-os** repo worktree, NOT this one)

- [ ] Add to the intervu service: env `VIEWER_SESSION_FILE=/var/lib/intervu-viewer/sessions.json` and a bind volume `./intervu-viewer-state:/var/lib/intervu-viewer`. Read the existing file first and match its volume/env conventions exactly. This is one small PR on its own branch.

---

## Self-review (done at write time)

- **Spec coverage:** D8 → A1/A2/A3/A4/B2 · D9 → A5/A6/B3 · D10 → B1/C1 · D11 → A4/B2 · D12 + labels → A3(viewer.mjs)/A6 · dead links → B2 · tap-to-zoom label lie → B2 (zoom moves to chip; label only meaningful in control-off) · non-goals untouched.
- **Type consistency:** wire contract stated once in Global Constraints; A1's builders, A2's validator, A3/B2's senders all reference it. `lanUrls` label contract in A3 matches viewer.mjs consumption in A3's last step. `negotiate`/`ignoreSdp` names used only in A4.
- **Placeholder scan:** no TBDs; A2/A4/A5 describe tests behaviorally rather than verbatim code — each names the exact assertions, stubs, and edge cases, and the implementing agent reads the neighboring test files first (existing suites: `viewer-signal-client.test.ts`, `viewer-webrtc-loopback.test.ts` are the pattern source).

## Verification after all tracks (orchestrator)

1. `npm run test:viewer && npm run test:agent` — all green.
2. `npm run build` — compiles.
3. Review diffs per track, commit per track, PR `feat/viewer-v2` → main.
4. Real-device pass per spec (phone on cellular via tailnet; tap+type on a real ATS form; mid-session deploy; doorbell tab-close reconnect). **security-pass skill before ship.**

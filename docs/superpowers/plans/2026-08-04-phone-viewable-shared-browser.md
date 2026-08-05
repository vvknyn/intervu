# Phone-viewable Shared Browser (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user watch the OpenClaw apply agent fill a job application form, live, from their phone, with no new setup steps in the one-command installer.

**Architecture:** A Node script on the user's laptop attaches to the Chrome DevTools Protocol endpoint OpenClaw already exposes (`127.0.0.1:18800`), pulls JPEG frames via `Page.startScreencast`, and ships them to a page in mobile Safari. Two transports sit behind one seam: a zero-dependency SSE server for same-WiFi, and a WebRTC data channel for cellular. intervu.cc hosts only signaling — a few KB per session — so all compute and every pixel stay on the user's machine.

**Tech Stack:** Node 22 (already required by OpenClaw), plain `node:http`, `werift@0.24.3` (pure-JS WebRTC), Next.js 16.1.5 App Router, Firebase Admin, `node:test` + `tsx` for unit tests, Playwright for e2e.

## Global Constraints

- **Watch-only.** v1 forwards no input. No `Input.dispatchMouseEvent`, no click/type handlers on the phone page. (Spec D1)
- **Media never transits our servers.** intervu.cc carries signaling only. (Spec D6)
- **Zero user-visible installer delta.** `openclaw/install.sh` must remain 8 user-facing steps. No new prompts, accounts, logins, or manual commands. (Spec, "What ships where")
- **Fit-to-width on the phone.** No auto-follow of the active field in v1. (Spec D3)
- **The phone requires a normal intervu login.** (Spec D4)
- **CDP base URL is `http://127.0.0.1:18800`** — verified live 2026-08-04 (Chrome 150.0.7871.188, protocol 1.3). Never hardcode elsewhere; read from `OPENCLAW_CDP_URL` with that default.
- **Unit tests** live in `tests/unit/<name>.test.ts`, use `node:test` + `node:assert/strict`, and run via `npx tsx --test tests/unit/<name>.test.ts`. This repo has **no vitest** — do not add it.
- **Fail loudly, never silently.** Any unreachable dependency exits non-zero with a message naming the thing that failed. (intervu #113 "never go silent")
- Session TTL is **15 minutes**; sessions are deleted at handoff.

---

## File Structure

| File | Responsibility |
|---|---|
| `openclaw/scripts/viewer/cdp-targets.mjs` | Discover which Chrome tab the agent is driving |
| `openclaw/scripts/viewer/frame-pump.mjs` | CDP screencast protocol: start, receive frames, acknowledge |
| `openclaw/scripts/viewer/transport-lan.mjs` | SSE transport over plain `node:http` (same-WiFi) |
| `openclaw/scripts/viewer/transport-webrtc.mjs` | WebRTC data-channel transport via werift (cellular) |
| `openclaw/scripts/viewer/watch-page.html` | The page served by the LAN transport |
| `openclaw/scripts/viewer.mjs` | Entry point: wires source → transports, owns lifecycle |
| `src/lib/agent/http.ts` | `extractBearerToken` — moved out of the route module |
| `src/lib/viewer/sessions.ts` | Session create/get/signal/delete on Firestore |
| `src/app/api/viewer/session/route.ts` | Doorbell: create a session (bearer auth) |
| `src/app/api/viewer/session/[id]/signal/route.ts` | Doorbell: exchange connection details |
| `src/app/watch/[id]/page.tsx` | The phone page (login-gated) |
| `src/components/viewer/watch-canvas.tsx` | Client component: connect, draw frames |

**Interface note on the Transport seam:** the spec listed `onMessage` on the transport contract. v1 is watch-only, so the inbound direction has no consumer and is **deliberately not implemented** — adding it now would be dead code. It arrives with input forwarding in v2. The v1 contract is:

```js
/**
 * @typedef {Object} Transport
 * @property {() => Promise<{url: string|null}>} start
 * @property {(frameBase64: string) => void} sendFrame
 * @property {() => Promise<void>} close
 */
```

---

### Task 1: FrameSource — CDP target discovery and the screencast pump

**Files:**
- Create: `openclaw/scripts/viewer/cdp-targets.mjs`
- Create: `openclaw/scripts/viewer/frame-pump.mjs`
- Test: `tests/unit/viewer-frame-source.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `listPageTargets(cdpBase: string, fetchImpl?: typeof fetch): Promise<Target[]>` where `Target = { id: string, type: string, title: string, url: string, webSocketDebuggerUrl: string }`
  - `pickActiveTarget(targets: Target[]): Target | null`
  - `createFramePump({ send, onFrame }): { start(): void, handle(msg: object): void }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/viewer-frame-source.test.ts`:

```ts
import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { listPageTargets, pickActiveTarget } from '../../openclaw/scripts/viewer/cdp-targets.mjs';
import { createFramePump } from '../../openclaw/scripts/viewer/frame-pump.mjs';

const TARGETS = [
  { id: 'a', type: 'page', title: 'Ashby — Apply', url: 'https://jobs.ashbyhq.com/x', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/page/a' },
  { id: 'b', type: 'page', title: 'Resume', url: 'http://localhost:9000/resume.html', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/page/b' },
  { id: 'c', type: 'service_worker', title: 'sw', url: 'https://x/sw.js', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/worker/c' },
  { id: 'd', type: 'page', title: 'No debugger', url: 'https://y', webSocketDebuggerUrl: '' },
];

describe('cdp-targets', () => {
  it('keeps only page targets that expose a debugger socket', async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => TARGETS });
    const out = await listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch);
    assert.deepEqual(out.map((t) => t.id), ['a', 'b']);
  });

  it('throws a message naming the port when CDP is unreachable', async () => {
    const fake = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch),
      (e: Error) => e.message.includes('18800'),
    );
  });

  it('throws naming the status when CDP answers non-200', async () => {
    const fake = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch),
      (e: Error) => e.message.includes('503'),
    );
  });

  it('picks the first page target (CDP lists most-recently-active first)', () => {
    assert.equal(pickActiveTarget(TARGETS.slice(0, 2))?.id, 'a');
    assert.equal(pickActiveTarget([]), null);
  });
});

describe('frame-pump', () => {
  it('enables the page and starts a screencast on start()', () => {
    const sent: any[] = [];
    const pump = createFramePump({ send: (m: any) => sent.push(m), onFrame: () => {} });
    pump.start();
    const methods = sent.map((m) => m.method);
    assert.ok(methods.includes('Page.enable'));
    assert.ok(methods.includes('Page.startScreencast'));
    const cast = sent.find((m) => m.method === 'Page.startScreencast');
    assert.equal(cast.params.format, 'jpeg');
  });

  it('emits each frame and acknowledges it so Chrome sends the next', () => {
    const sent: any[] = [];
    const frames: string[] = [];
    const pump = createFramePump({ send: (m: any) => sent.push(m), onFrame: (f: any) => frames.push(f.data) });
    pump.start();
    pump.handle({ method: 'Page.screencastFrame', params: { data: 'AAAA', sessionId: 7, metadata: {} } });
    assert.deepEqual(frames, ['AAAA']);
    const ack = sent.find((m) => m.method === 'Page.screencastFrameAck');
    assert.equal(ack.params.sessionId, 7);
  });

  it('ignores unrelated CDP messages without emitting or acking', () => {
    const sent: any[] = [];
    const frames: string[] = [];
    const pump = createFramePump({ send: (m: any) => sent.push(m), onFrame: (f: any) => frames.push(f.data) });
    pump.start();
    const before = sent.length;
    pump.handle({ method: 'Network.requestWillBeSent', params: {} });
    pump.handle({ id: 1, result: {} });
    assert.equal(frames.length, 0);
    assert.equal(sent.length, before);
  });

  it('uses a unique id for every outbound command', () => {
    const sent: any[] = [];
    const pump = createFramePump({ send: (m: any) => sent.push(m), onFrame: () => {} });
    pump.start();
    pump.handle({ method: 'Page.screencastFrame', params: { data: 'B', sessionId: 1, metadata: {} } });
    const ids = sent.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/viewer-frame-source.test.ts`
Expected: FAIL — `Cannot find module '../../openclaw/scripts/viewer/cdp-targets.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `openclaw/scripts/viewer/cdp-targets.mjs`:

```js
/**
 * Finds the Chrome tab the OpenClaw agent is driving.
 *
 * OpenClaw runs a real (headed) Chrome with the DevTools Protocol on
 * 127.0.0.1:18800 — verified on the live install, not assumed. `/json/list`
 * returns targets most-recently-activated first, which is why picking the
 * first page is the same as picking the tab the agent just acted on. The
 * skill's two-tab protocol (form tab + resume tab) means that choice
 * genuinely matters.
 */

export async function listPageTargets(cdpBase, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${cdpBase}/json/list`);
  } catch (cause) {
    throw new Error(`Cannot reach Chrome's debug port at ${cdpBase} — is OpenClaw's browser running? (openclaw browser status)`, { cause });
  }
  if (!res.ok) {
    throw new Error(`Chrome's debug port at ${cdpBase} answered HTTP ${res.status}`);
  }
  const targets = await res.json();
  return targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

export function pickActiveTarget(targets) {
  return targets[0] ?? null;
}
```

Create `openclaw/scripts/viewer/frame-pump.mjs`:

```js
/**
 * Speaks the CDP screencast protocol. Deliberately transport-free and
 * socket-free: it is handed a `send` and fed raw messages, so the whole
 * protocol is unit-testable without a browser.
 *
 * Two properties of Page.startScreencast carry the performance story:
 * Chrome emits a frame only when pixels actually change (an idle form is
 * free), and it will not send the next frame until the last is acked — so
 * acking on delivery makes a slow phone link self-throttle rather than
 * build a backlog.
 */

const MAX_DIMENSION = 1280;

export function createFramePump({ send, onFrame }) {
  let nextId = 1;
  const cmd = (method, params) => send({ id: nextId++, method, params });

  return {
    start() {
      cmd("Page.enable", {});
      cmd("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: MAX_DIMENSION,
        maxHeight: MAX_DIMENSION,
        everyNthFrame: 1,
      });
    },

    handle(msg) {
      if (msg?.method !== "Page.screencastFrame") return;
      const { data, sessionId, metadata } = msg.params;
      onFrame({ data, metadata });
      cmd("Page.screencastFrameAck", { sessionId });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/viewer-frame-source.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add openclaw/scripts/viewer/cdp-targets.mjs openclaw/scripts/viewer/frame-pump.mjs tests/unit/viewer-frame-source.test.ts
git commit -m "feat(viewer): CDP target discovery and screencast frame pump"
```

---

### Task 2: LAN transport, viewer entry point, and the watch page

Delivers the **first visible milestone**: run the viewer, open the printed URL on a phone on the same WiFi, and watch the agent's Chrome live.

**Files:**
- Create: `openclaw/scripts/viewer/transport-lan.mjs`
- Create: `openclaw/scripts/viewer/watch-page.html`
- Create: `openclaw/scripts/viewer.mjs`
- Test: `tests/unit/viewer-transport-lan.test.ts`

**Interfaces:**
- Consumes: `listPageTargets`, `pickActiveTarget`, `createFramePump` (Task 1)
- Produces:
  - `createLanTransport({ port?, token }): Transport` with `start(): Promise<{url: string|null}>`, `sendFrame(base64: string): void`, `close(): Promise<void>`
  - `lanUrls(port: number, token: string, ifaces?: object): string[]` — pure, testable

- [ ] **Step 1: Write the failing test**

Create `tests/unit/viewer-transport-lan.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { createLanTransport, lanUrls } from '../../openclaw/scripts/viewer/transport-lan.mjs';

const IFACES = {
  lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  utun3: [{ family: 'IPv6', internal: false, address: 'fe80::1' }],
};

describe('lanUrls', () => {
  it('builds a URL per external IPv4 address, carrying the token', () => {
    const urls = lanUrls(18801, 'tok123', IFACES);
    assert.deepEqual(urls, ['http://192.168.1.42:18801/?t=tok123']);
  });

  it('returns an empty list when there is no external IPv4', () => {
    assert.deepEqual(lanUrls(18801, 'tok', { lo0: IFACES.lo0 }), []);
  });
});

describe('createLanTransport', () => {
  const transport = createLanTransport({ port: 0, token: 'secret-token' });
  before(async () => { await transport.start(); });
  after(async () => { await transport.close(); });

  it('serves the watch page only to a request carrying the right token', async () => {
    const base = `http://127.0.0.1:${transport.port()}`;
    const bad = await fetch(`${base}/?t=wrong`);
    assert.equal(bad.status, 403);
    const none = await fetch(`${base}/`);
    assert.equal(none.status, 403);
    const ok = await fetch(`${base}/?t=secret-token`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /<canvas/);
  });

  it('rejects an unauthorised stream subscriber', async () => {
    const base = `http://127.0.0.1:${transport.port()}`;
    const res = await fetch(`${base}/stream?t=wrong`);
    assert.equal(res.status, 403);
  });

  it('pushes a frame to a subscribed client as an SSE event', async () => {
    const base = `http://127.0.0.1:${transport.port()}`;
    const res = await fetch(`${base}/stream?t=secret-token`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body!.getReader();
    transport.sendFrame('QUJD');
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data: QUJD/);
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/viewer-transport-lan.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `openclaw/scripts/viewer/transport-lan.mjs`:

```js
/**
 * Same-WiFi transport. Server-Sent Events over plain node:http — no
 * WebSocket library and no dependency at all, which is only possible
 * because v1 is watch-only and therefore one-way. When input forwarding
 * lands this becomes a duplex channel and will need a real socket.
 */

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "watch-page.html"), "utf8");

export function lanUrls(port, token, ifaces = networkInterfaces()) {
  return Object.values(ifaces)
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}/?t=${token}`);
}

export function createLanTransport({ port = 18801, token }) {
  const clients = new Set();
  let server = null;

  const authorised = (url) => url.searchParams.get("t") === token;

  const handler = (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!authorised(url)) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("forbidden");
    }
    if (url.pathname === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  };

  return {
    async start() {
      server = createServer(handler);
      await new Promise((resolve) => server.listen(port, resolve));
      const urls = lanUrls(server.address().port, token);
      return { url: urls[0] ?? null };
    },
    port() {
      return server?.address()?.port ?? null;
    },
    sendFrame(base64) {
      for (const res of clients) res.write(`data: ${base64}\n\n`);
    },
    async close() {
      for (const res of clients) res.end();
      clients.clear();
      if (server) await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}
```

Create `openclaw/scripts/viewer/watch-page.html`:

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<title>Watching your agent</title>
<style>
  html,body{margin:0;background:#111;color:#eee;font:14px/1.4 -apple-system,system-ui,sans-serif}
  header{padding:10px 14px;border-bottom:1px solid #2a2a2a;display:flex;gap:8px;align-items:center}
  #dot{width:8px;height:8px;border-radius:9999px;background:#666}
  #dot.live{background:#3ddc84}
  canvas{display:block;width:100%;height:auto}
</style>
<header><span id="dot"></span><span id="status">connecting…</span></header>
<canvas id="screen"></canvas>
<script>
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const token = new URLSearchParams(location.search).get('t');

  function draw(base64) {
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width; canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
      dot.className = 'live';
      status.textContent = 'live';
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  }

  const es = new EventSource('/stream?t=' + encodeURIComponent(token));
  es.onmessage = (e) => draw(e.data);
  es.onerror = () => { dot.className = ''; status.textContent = 'disconnected — the agent may have finished'; };
</script>
```

Create `openclaw/scripts/viewer.mjs`:

```js
#!/usr/bin/env node
/**
 * Entry point. Wires CDP frames into whichever transports are available and
 * prints the watch URL(s) on stdout, one per line, prefixed `WATCH:` — the
 * skill greps for that prefix and sends the URL over WhatsApp.
 *
 * Lifecycle is owned by the skill: started when form-filling begins, stopped
 * at handoff. Nothing listens while no application is in flight.
 */

import { randomBytes } from "node:crypto";
import { listPageTargets, pickActiveTarget } from "./viewer/cdp-targets.mjs";
import { createFramePump } from "./viewer/frame-pump.mjs";
import { createLanTransport } from "./viewer/transport-lan.mjs";

const CDP_BASE = process.env.OPENCLAW_CDP_URL || "http://127.0.0.1:18800";

async function main() {
  const targets = await listPageTargets(CDP_BASE);
  const target = pickActiveTarget(targets);
  if (!target) {
    console.error(`No open Chrome tab found at ${CDP_BASE}. Open the application form first, then start the viewer.`);
    process.exit(1);
  }

  const token = randomBytes(24).toString("base64url");
  const lan = createLanTransport({ token });
  const { url } = await lan.start();
  if (url) console.log(`WATCH: ${url}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pump = createFramePump({
    send: (m) => socket.send(JSON.stringify(m)),
    onFrame: (f) => lan.sendFrame(f.data),
  });

  socket.addEventListener("open", () => pump.start());
  socket.addEventListener("message", (ev) => pump.handle(JSON.parse(ev.data)));
  socket.addEventListener("error", (e) => {
    console.error(`Lost the connection to Chrome (${target.id}): ${e.message ?? e}`);
    process.exit(1);
  });

  const shutdown = async () => { await lan.close(); socket.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

**Why there is no WebSocket import:** Node exposes `WebSocket` as a global — verified on the target runtime (`node -e "console.log(typeof WebSocket)"` → `function` on v22.20.0), so no dependency is needed to talk to Chrome. If a future Node drops it, add `ws` to `openclaw/package.json` in Task 5 and import from there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/viewer-transport-lan.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Verify the real thing end-to-end**

```bash
openclaw browser open "https://jobs.ashbyhq.com"       # any real page
node openclaw/scripts/viewer.mjs                        # prints WATCH: http://192.168.x.x:18801/?t=...
```

Open that URL on a phone on the same WiFi. Expected: the Chrome tab appears and updates as it changes. **This is the milestone — look at it before continuing.**

- [ ] **Step 6: Commit**

```bash
git add openclaw/scripts/viewer.mjs openclaw/scripts/viewer/transport-lan.mjs openclaw/scripts/viewer/watch-page.html tests/unit/viewer-transport-lan.test.ts
git commit -m "feat(viewer): LAN transport, watch page, and viewer entry point"
```

---

### Task 3: Move `extractBearerToken` out of the route module

Small but its own reviewable unit: importing it from `src/app/api/mcp/route.ts` would drag `mcp-handler`, every agent tool, and the Firebase Admin SDK into the doorbell route's module graph. This repo has already been bitten by exactly that class of bug (constants imported from `tools.ts` pulled Admin SDK into the client bundle, fixed by extracting a zero-I/O `facets.ts`).

**Files:**
- Create: `src/lib/agent/http.ts`
- Modify: `src/app/api/mcp/route.ts:47` (delete the local definition, import instead)
- Test: `tests/unit/viewer-http.test.ts`

**Interfaces:**
- Produces: `extractBearerToken(request: Request): string | undefined`

- [ ] **Step 1: Read the current definition so behaviour is preserved exactly**

Run: `sed -n '40,60p' src/app/api/mcp/route.ts`
Copy the body verbatim into the new file — this is a move, not a rewrite.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/viewer-http.test.ts`:

```ts
import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { extractBearerToken } from '../../src/lib/agent/http';

const req = (headers: Record<string, string>) => new Request('https://intervu.cc/api/viewer/session', { headers });

describe('extractBearerToken', () => {
  it('reads a Bearer token', () => {
    assert.equal(extractBearerToken(req({ authorization: 'Bearer iva_abc' })), 'iva_abc');
  });
  it('is case-insensitive on the scheme', () => {
    assert.equal(extractBearerToken(req({ authorization: 'bearer iva_abc' })), 'iva_abc');
  });
  it('returns undefined with no header', () => {
    assert.equal(extractBearerToken(req({})), undefined);
  });
  it('returns undefined for a non-Bearer scheme', () => {
    assert.equal(extractBearerToken(req({ authorization: 'Basic dXNlcjpwdw==' })), undefined);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test tests/unit/viewer-http.test.ts`
Expected: FAIL — cannot find `src/lib/agent/http`

- [ ] **Step 4: Create the module and rewire the route**

Create `src/lib/agent/http.ts` containing the moved function (body copied from step 1) with this doc comment:

```ts
/**
 * Bearer-token extraction, kept in a zero-I/O module so route handlers can
 * share it without importing each other. Importing it from the MCP route
 * would pull `mcp-handler`, every agent tool and the Firebase Admin SDK into
 * the importing route's module graph.
 */
```

Then in `src/app/api/mcp/route.ts`: delete the local `export function extractBearerToken`, and add `import { extractBearerToken } from "@/lib/agent/http";`.

- [ ] **Step 5: Run tests to verify nothing regressed**

Run: `npx tsx --test tests/unit/viewer-http.test.ts && npm run test:agent`
Expected: PASS both. The agent suite exercises the MCP route and must stay green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/http.ts src/app/api/mcp/route.ts tests/unit/viewer-http.test.ts
git commit -m "refactor(agent): extract extractBearerToken into a zero-I/O module"
```

---

### Task 4: The doorbell — session store and routes

**Files:**
- Create: `src/lib/viewer/sessions.ts`
- Create: `src/app/api/viewer/session/route.ts`
- Create: `src/app/api/viewer/session/[id]/signal/route.ts`
- Test: `tests/unit/viewer-sessions.test.ts`

**Interfaces:**
- Consumes: `extractBearerToken` (Task 3); `verifySecret`, `firestoreStore` (existing, `src/lib/agent/tokens.ts` / `store.ts`); `getAdminDb` (`src/lib/firebase/admin.ts:41`)
- Produces:
  - `type ViewerSession = { id: string; uid: string; createdAt: number; expiresAt: number; host: SignalBlob | null; guest: SignalBlob | null }`
  - `type SignalBlob = { sdp: string; ice: string[] }`
  - `newSessionId(): string`
  - `isExpired(s: Pick<ViewerSession,'expiresAt'>, now?: number): boolean`
  - `canRead(s: Pick<ViewerSession,'uid'>, uid: string): boolean`
  - `VIEWER_SESSION_TTL_MS: number`

- [ ] **Step 1: Write the failing test** (pure logic only — no Firestore in unit tests)

Create `tests/unit/viewer-sessions.test.ts`:

```ts
import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { newSessionId, isExpired, canRead, VIEWER_SESSION_TTL_MS } from '../../src/lib/viewer/sessions';

describe('viewer sessions', () => {
  it('mints unguessable ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionId()));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.ok(id.length >= 22, `id too short: ${id}`);
  });

  it('expires exactly at the TTL boundary, not before', () => {
    const created = 1_000_000;
    const s = { expiresAt: created + VIEWER_SESSION_TTL_MS };
    assert.equal(isExpired(s, created + VIEWER_SESSION_TTL_MS - 1), false);
    assert.equal(isExpired(s, created + VIEWER_SESSION_TTL_MS), true);
  });

  it('is a 15 minute TTL', () => {
    assert.equal(VIEWER_SESSION_TTL_MS, 15 * 60 * 1000);
  });

  it('binds a session to exactly one account', () => {
    assert.equal(canRead({ uid: 'user-a' }, 'user-a'), true);
    assert.equal(canRead({ uid: 'user-a' }, 'user-b'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/viewer-sessions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/lib/viewer/sessions.ts`**

```ts
/**
 * Viewer sessions: the doorbell's entire state. A session exists only to let
 * two devices find each other; it carries connection details and never a
 * single frame of media. Short-lived by design and deleted at handoff.
 */
import { randomBytes } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";

export const VIEWER_SESSION_TTL_MS = 15 * 60 * 1000;
const COLLECTION = "viewer_sessions";

export type SignalBlob = { sdp: string; ice: string[] };
export type ViewerSession = {
    id: string;
    uid: string;
    createdAt: number;
    expiresAt: number;
    host: SignalBlob | null;
    guest: SignalBlob | null;
};

/** 24 random bytes — the id is a capability, so guessing must be hopeless. */
export function newSessionId(): string {
    return randomBytes(24).toString("base64url");
}

export function isExpired(s: Pick<ViewerSession, "expiresAt">, now = Date.now()): boolean {
    return now >= s.expiresAt;
}

export function canRead(s: Pick<ViewerSession, "uid">, uid: string): boolean {
    return s.uid === uid;
}

export async function createSession(uid: string, now = Date.now()): Promise<ViewerSession> {
    const session: ViewerSession = {
        id: newSessionId(), uid, createdAt: now,
        expiresAt: now + VIEWER_SESSION_TTL_MS, host: null, guest: null,
    };
    await getAdminDb().collection(COLLECTION).doc(session.id).set(session);
    return session;
}

export async function getSession(id: string): Promise<ViewerSession | null> {
    const snap = await getAdminDb().collection(COLLECTION).doc(id).get();
    return snap.exists ? (snap.data() as ViewerSession) : null;
}

export async function putSignal(id: string, role: "host" | "guest", blob: SignalBlob): Promise<void> {
    await getAdminDb().collection(COLLECTION).doc(id).set({ [role]: blob }, { merge: true });
}

export async function deleteSession(id: string): Promise<void> {
    await getAdminDb().collection(COLLECTION).doc(id).delete();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/viewer-sessions.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Write the create route**

Create `src/app/api/viewer/session/route.ts`:

```ts
/**
 * POST /api/viewer/session — the laptop rings the doorbell.
 *
 * Authenticated with the same bearer credential mcporter already holds, so
 * the user grants nothing new. Returns the URL to open on the phone.
 */
import { NextResponse } from "next/server";
import { extractBearerToken } from "@/lib/agent/http";
import { verifySecret } from "@/lib/agent/tokens";
import { firestoreStore } from "@/lib/agent/store";
import { createSession } from "@/lib/viewer/sessions";

export async function POST(request: Request) {
    const secret = extractBearerToken(request);
    if (!secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const credential = await verifySecret(firestoreStore(), secret);
    if (!credential) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const session = await createSession(credential.uid);
    const origin = new URL(request.url).origin;
    return NextResponse.json({
        sessionId: session.id,
        watchUrl: `${origin}/watch/${session.id}`,
        expiresAt: session.expiresAt,
    });
}
```

- [ ] **Step 6: Write the signaling route**

Create `src/app/api/viewer/session/[id]/signal/route.ts`:

```ts
/**
 * The introduction itself. Both devices POST their connection details here
 * and GET the other side's. A few KB per session, then both sides talk
 * directly and this endpoint is never called again.
 *
 * The host authenticates with its bearer credential; the guest (the phone)
 * with its normal intervu login. Either way the session's uid must match.
 */
import { NextResponse } from "next/server";
import { extractBearerToken } from "@/lib/agent/http";
import { verifySecret } from "@/lib/agent/tokens";
import { firestoreStore } from "@/lib/agent/store";
import { getServerUser } from "@/lib/firebase/auth-session";
import { getSession, putSignal, deleteSession, isExpired, canRead, type SignalBlob } from "@/lib/viewer/sessions";

async function callerUid(request: Request): Promise<string | null> {
    const secret = extractBearerToken(request);
    if (secret) return (await verifySecret(firestoreStore(), secret))?.uid ?? null;
    return (await getServerUser())?.uid ?? null;
}

async function authorise(request: Request, id: string) {
    const uid = await callerUid(request);
    if (!uid) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    const session = await getSession(id);
    if (!session || isExpired(session)) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
    if (!canRead(session, uid)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    return { session };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { session, error } = await authorise(request, id);
    if (error) return error;
    return NextResponse.json({ host: session!.host, guest: session!.guest });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { error } = await authorise(request, id);
    if (error) return error;

    const body = (await request.json()) as { role?: string; sdp?: string; ice?: string[] };
    if (body.role !== "host" && body.role !== "guest") {
        return NextResponse.json({ error: "role must be host or guest" }, { status: 400 });
    }
    if (typeof body.sdp !== "string" || !Array.isArray(body.ice)) {
        return NextResponse.json({ error: "sdp (string) and ice (array) are required" }, { status: 400 });
    }
    await putSignal(id, body.role, { sdp: body.sdp, ice: body.ice } satisfies SignalBlob);
    return NextResponse.json({ ok: true });
}

/**
 * Called by the viewer at handoff. The spec requires a session to die when
 * the application is handed over rather than linger until its TTL, so this
 * is not optional cleanup — it is the security boundary.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { error } = await authorise(request, id);
    if (error) return error;
    await deleteSession(id);
    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Verify the build type-checks**

Run: `npx tsc --noEmit`
Expected: no errors introduced by these files.

- [ ] **Step 8: Commit**

```bash
git add src/lib/viewer/sessions.ts src/app/api/viewer tests/unit/viewer-sessions.test.ts
git commit -m "feat(viewer): doorbell session store and signaling routes"
```

---

### Task 5: WebRTC transport, packaging, and the installer

**Files:**
- Create: `openclaw/scripts/viewer/transport-webrtc.mjs`
- Modify: `openclaw/scripts/viewer.mjs` (add the second transport)
- Create: `openclaw/package.json`
- Modify: `scripts/prebuild-openclaw.mjs:34` (exclude `node_modules`)
- Modify: `openclaw/install.sh` (install skill deps after extraction)
- Modify: `.gitignore`
- Test: `tests/unit/viewer-signal-client.test.ts`

**Interfaces:**
- Consumes: the doorbell routes (Task 4)
- Produces: `createWebRtcTransport({ apiBase, bearer }): Transport`, plus pure helpers `signalUrl(apiBase, id)` and `pollUntilGuest(fetchImpl, url, { attempts, delayMs })`

- [ ] **Step 1: Add the dependency manifest**

Create `openclaw/package.json`:

```json
{
  "name": "intervu-apply-skill",
  "private": true,
  "type": "module",
  "dependencies": {
    "werift": "0.24.3"
  }
}
```

Pinned exactly — a skill that self-updates its WebRTC stack on a stranger's laptop is not something we can debug.

- [ ] **Step 2: Stop `node_modules` leaking into the served artifact**

The prebuild tars the whole `openclaw/` directory, so a local install would otherwise ship inside the public tarball.

In `scripts/prebuild-openclaw.mjs:34`, change the tar arguments to add an exclude **before** `-czf`:

```js
["--exclude=install.sh", "--exclude=./node_modules", "-czf", join(publicDir, "intervu-apply-skill.tar.gz"), "-C", openclawDir, "."],
```

Append to `.gitignore`:

```
openclaw/node_modules/
```

- [ ] **Step 3: Verify the artifact stays clean**

```bash
npm i --prefix openclaw
node scripts/prebuild-openclaw.mjs
tar -tzf public/intervu-apply-skill.tar.gz | grep -c node_modules
```

Expected: `0`. Also confirm the viewer files ARE present:

```bash
tar -tzf public/intervu-apply-skill.tar.gz | grep viewer
```

Expected: `./scripts/viewer.mjs` and the four `./scripts/viewer/*` files.

- [ ] **Step 4: Write the failing test for the signaling client helpers**

Create `tests/unit/viewer-signal-client.test.ts`:

```ts
import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { signalUrl, pollUntilGuest } from '../../openclaw/scripts/viewer/transport-webrtc.mjs';

describe('signalUrl', () => {
  it('builds the signaling path for a session', () => {
    assert.equal(signalUrl('https://intervu.cc', 'abc'), 'https://intervu.cc/api/viewer/session/abc/signal');
  });
  it('tolerates a trailing slash on the base', () => {
    assert.equal(signalUrl('https://intervu.cc/', 'abc'), 'https://intervu.cc/api/viewer/session/abc/signal');
  });
});

describe('pollUntilGuest', () => {
  it('returns the guest blob as soon as it appears', async () => {
    let n = 0;
    const fake = async () => ({ ok: true, json: async () => (++n < 3 ? { guest: null } : { guest: { sdp: 'v=0', ice: [] } }) });
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { attempts: 10, delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
    assert.equal(n, 3);
  });

  it('gives up after the attempt budget rather than hanging forever', async () => {
    const fake = async () => ({ ok: true, json: async () => ({ guest: null }) });
    await assert.rejects(
      () => pollUntilGuest(fake as unknown as typeof fetch, 'u', { attempts: 3, delayMs: 0 }),
      (e: Error) => /never connected/i.test(e.message),
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx tsx --test tests/unit/viewer-signal-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 6: Write `openclaw/scripts/viewer/transport-webrtc.mjs`**

```js
/**
 * Cellular transport. The laptop is the offerer; the phone answers. Once the
 * two are introduced the connection is direct, so media never touches
 * intervu.cc — which is why "we cannot see your screen" is a property of the
 * design rather than a promise.
 *
 * Frames ride a data channel rather than a video track because CDP already
 * hands us finished JPEGs; encoding to H.264 would mean decoding and
 * re-encoding for no benefit.
 */

import { RTCPeerConnection } from "werift";

export function signalUrl(apiBase, id) {
  return `${apiBase.replace(/\/$/, "")}/api/viewer/session/${id}/signal`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollUntilGuest(fetchImpl, url, { attempts = 60, delayMs = 2000, headers = {} } = {}) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetchImpl(url, { headers });
    if (res.ok) {
      const body = await res.json();
      if (body.guest) return body.guest;
    }
    await sleep(delayMs);
  }
  throw new Error("The phone never connected — the watch link may not have been opened.");
}

export function createWebRtcTransport({ apiBase, bearer, fetchImpl = fetch }) {
  const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
  let pc = null, channel = null, sessionId = null;

  return {
    async start() {
      const created = await fetchImpl(`${apiBase.replace(/\/$/, "")}/api/viewer/session`, { method: "POST", headers: auth });
      if (!created.ok) throw new Error(`Could not open a viewer session (HTTP ${created.status}). Is the agent still signed in?`);
      const { sessionId: id, watchUrl } = await created.json();
      sessionId = id;

      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      channel = pc.createDataChannel("frames");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await pc.iceGatheringStateChangeDone?.();

      const url = signalUrl(apiBase, sessionId);
      await fetchImpl(url, {
        method: "POST", headers: auth,
        body: JSON.stringify({ role: "host", sdp: pc.localDescription.sdp, ice: [] }),
      });

      const guest = await pollUntilGuest(fetchImpl, url, { headers: auth });
      await pc.setRemoteDescription({ type: "answer", sdp: guest.sdp });

      return { url: watchUrl };
    },

    sendFrame(base64) {
      if (channel?.readyState === "open") channel.send(base64);
    },

    async close() {
      try { channel?.close(); pc?.close(); } catch { /* already torn down */ }
      if (sessionId) {
        await fetchImpl(signalUrl(apiBase, sessionId), { method: "DELETE", headers: auth }).catch(() => {});
      }
    },
  };
}
```

**Implementer note:** `pc.iceGatheringStateChangeDone?.()` is werift's gathering-complete hook and the API name must be confirmed against the installed package before relying on it — run `node -e "import('werift').then(m=>console.log(Object.keys(new m.RTCPeerConnection())))"`. If it does not exist, wait on `pc.onicecandidate` firing with a null candidate instead. Do not ship a guess.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx tsx --test tests/unit/viewer-signal-client.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 8: Wire the second transport into `viewer.mjs`**

In `openclaw/scripts/viewer.mjs`, replace the single-transport block with both, and fan each frame out to whichever are live:

```js
const transports = [];
const lan = createLanTransport({ token });
const { url: lanUrl } = await lan.start();
transports.push(lan);
if (lanUrl) console.log(`WATCH-LAN: ${lanUrl}`);

if (process.env.INTERVU_BEARER) {
  try {
    const rtc = createWebRtcTransport({ apiBase: process.env.INTERVU_API_BASE || "https://intervu.cc", bearer: process.env.INTERVU_BEARER });
    const { url } = await rtc.start();
    transports.push(rtc);
    console.log(`WATCH: ${url}`);
  } catch (err) {
    console.error(`Remote viewing unavailable (${err.message}). The same-WiFi link above still works.`);
  }
}
```

and change the pump's `onFrame` to `(f) => { for (const t of transports) t.sendFrame(f.data); }`, and `shutdown` to close all of them.

- [ ] **Step 9: Install skill dependencies from the installer**

In `openclaw/install.sh`, immediately after the skill tarball is extracted and copied into place (section 5, after the `cp` completes and before the gateway restart in section 6), add:

```bash
# The viewer needs a pure-JS WebRTC stack. Installed here rather than
# vendored into the tarball so the download stays small; it must run AFTER
# extraction because skill install is rm-then-cp and would wipe it.
echo "==> Installing skill dependencies..."
npm install --prefix "$SKILL_DIR" --omit=dev --silent >/dev/null 2>&1 || {
  echo "    Could not install viewer dependencies — phone viewing will fall back to same-WiFi only."
}
```

This adds **no user-facing step**: it prints one line and cannot prompt. Note it degrades rather than failing the install, because a broken viewer must never block the apply loop.

- [ ] **Step 10: Commit**

```bash
git add openclaw/scripts/viewer/transport-webrtc.mjs openclaw/scripts/viewer.mjs openclaw/package.json openclaw/install.sh scripts/prebuild-openclaw.mjs .gitignore tests/unit/viewer-signal-client.test.ts
git commit -m "feat(viewer): WebRTC transport, pinned deps, and installer wiring"
```

---

### Task 6: The `/watch/[id]` phone page

**Files:**
- Create: `src/app/watch/[id]/page.tsx`
- Create: `src/components/viewer/watch-canvas.tsx`
- Test: `tests/e2e/watch-page.spec.ts`

**Interfaces:**
- Consumes: the signaling routes (Task 4); `getServerUser` (`src/lib/firebase/auth-session.ts:17`)
- Produces: nothing downstream

- [ ] **Step 1: Write the server component with the login gate**

Create `src/app/watch/[id]/page.tsx`:

```tsx
/**
 * The page the user opens on their phone. Login-gated (spec D4): the link is
 * unguessable, but a leaked WhatsApp message must not be enough to watch
 * someone's application form being filled in.
 */
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/firebase/auth-session";
import { WatchCanvas } from "@/components/viewer/watch-canvas";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await getServerUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/watch/${id}`)}`);
    return <WatchCanvas sessionId={id} />;
}
```

**Implementer note:** confirm the login route is `/login` and that it honours a `next` parameter — run `ls src/app/login` and grep for `next` in that page. If the convention differs, match the existing one rather than inventing a redirect target.

- [ ] **Step 2: Write the client component**

Create `src/components/viewer/watch-canvas.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Answers the laptop's offer, then paints whatever arrives on the data
 * channel. Fit-to-width with pinch-zoom (spec D3) — no auto-follow in v1.
 */
export function WatchCanvas({ sessionId }: { sessionId: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState("connecting…");

    useEffect(() => {
        let pc: RTCPeerConnection | null = null;
        let cancelled = false;
        const url = `/api/viewer/session/${sessionId}/signal`;

        (async () => {
            const res = await fetch(url);
            if (!res.ok) { setStatus(res.status === 404 ? "this session has ended" : "you don't have access to this session"); return; }
            const { host } = await res.json();
            if (!host) { setStatus("waiting for your laptop…"); return; }

            pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
            pc.ondatachannel = (ev) => {
                ev.channel.onmessage = (m) => draw(m.data as string);
                ev.channel.onopen = () => setStatus("live");
            };
            await pc.setRemoteDescription({ type: "offer", sdp: host.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (cancelled) return;
            await fetch(url, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ role: "guest", sdp: answer.sdp, ice: [] }),
            });
        })().catch((e) => setStatus(`could not connect: ${e.message}`));

        function draw(base64: string) {
            const canvas = canvasRef.current; if (!canvas) return;
            const img = new Image();
            img.onload = () => {
                if (canvas.width !== img.width) { canvas.width = img.width; canvas.height = img.height; }
                canvas.getContext("2d")?.drawImage(img, 0, 0);
            };
            img.src = `data:image/jpeg;base64,${base64}`;
        }

        return () => { cancelled = true; pc?.close(); };
    }, [sessionId]);

    return (
        <main className="min-h-dvh bg-black text-white">
            <header className="px-4 py-3 border-b border-white/10 text-sm">{status}</header>
            <canvas ref={canvasRef} className="block w-full h-auto" />
        </main>
    );
}
```

- [ ] **Step 3: Write the e2e test**

Create `tests/e2e/watch-page.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('an unauthenticated visitor is sent to login, not shown the session', async ({ page }) => {
  await page.goto('/watch/some-unguessable-id');
  await expect(page).toHaveURL(/\/login/);
});

test('a signed-in user opening an unknown session is told it ended', async ({ page }) => {
  // Uses the repo's existing storageState-based auth; see tests/e2e/auth.spec.ts
  test.skip(!process.env.E2E_AUTH_STATE, 'requires an authenticated storage state');
  await page.goto('/watch/definitely-not-a-real-session-id');
  await expect(page.getByText(/session has ended|access/i)).toBeVisible();
});
```

**Implementer note:** match the repo's existing authenticated-test convention before writing the second test — read `tests/e2e/auth.spec.ts` and `playwright.config.ts` for how a signed-in context is produced, and use that instead of the `E2E_AUTH_STATE` guard above if a different mechanism exists.

- [ ] **Step 4: Run the tests**

Run: `npx tsc --noEmit && npx playwright test tests/e2e/watch-page.spec.ts`
Expected: tsc clean; the unauthenticated redirect test passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/watch src/components/viewer tests/e2e/watch-page.spec.ts
git commit -m "feat(viewer): login-gated watch page for the phone"
```

---

### Task 7: Teach the skill to start the viewer and send the link

**Files:**
- Modify: `openclaw/SKILL.md` (FORM FILL section, around line 347 where the form audit is described)

**Interfaces:**
- Consumes: `openclaw/scripts/viewer.mjs` (Tasks 2 and 5)

- [ ] **Step 1: Read the section that will change**

Run: `sed -n '330,370p' openclaw/SKILL.md`
The viewer must start **before** the pre-flight audit, so the user sees the form from the first field onward.

- [ ] **Step 2: Add the viewer step**

Insert into the FORM FILL phase, immediately before the pre-flight audit step:

```markdown
**WATCH FROM YOUR PHONE.** Before filling anything, start the viewer so the
user can follow along:

    node scripts/viewer.mjs &

It prints `WATCH: <url>` (remote) and/or `WATCH-LAN: <url>` (same WiFi).
Send the `WATCH:` line if present, otherwise `WATCH-LAN:`, with one short
message — for example: "Filling the Braze form now — watch here: <url>".
Do NOT send both links; pick one.

If the viewer prints neither, say so in one line and carry on filling the
form. Phone viewing is a convenience; it never blocks an application.

Stop it at handoff: `kill %1`.
```

- [ ] **Step 3: Verify the packaged artifact carries the change**

```bash
node scripts/prebuild-openclaw.mjs
tar -xzOf public/intervu-apply-skill.tar.gz ./SKILL.md | grep -c "WATCH FROM YOUR PHONE"
```

Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add openclaw/SKILL.md
git commit -m "feat(viewer): the agent starts the viewer and sends the watch link"
```

---

## Deviations from the spec (deliberate, flag if you disagree)

1. **`Transport.onMessage` is not implemented.** The spec's contract listed it, but v1 is
   watch-only so nothing would consume it. Building it now is dead code; it arrives with
   input forwarding in v2.
2. **The LAN fallback is a second link, not an automatic in-page failover.** The spec
   described the watch page falling back to LAN when peer-to-peer fails. This plan instead
   has the viewer print both URLs and the agent send one, with an explicit message when the
   remote link is unavailable. Same user-visible outcome, materially less machinery, and no
   silent fallback path to debug. The spec's requirement that failure is *explicit and never
   a blank screen* is preserved.
3. **`extractBearerToken` gets moved (Task 3), which the spec did not mention.** Importing it
   from the MCP route would drag `mcp-handler`, every agent tool, and the Admin SDK into the
   doorbell's module graph — a bug class this repo has already hit once.

## Final verification (run before opening the PR)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:agent` — the existing agent suite still passes (Task 3 touched the MCP route)
- [ ] `npx tsx --test tests/unit/viewer-*.test.ts` — all viewer unit tests pass
- [ ] `tar -tzf public/intervu-apply-skill.tar.gz | grep -c node_modules` returns `0`
- [ ] **End-to-end on real hardware, which component tests cannot replace** (the `file:` protocol defect, intervu #114, passed every component test and was only caught by running the whole loop): run the real agent against a real ATS form, open the `WATCH:` link on a phone **on cellular with WiFi off**, and confirm frames arrive.
- [ ] Register the new unit tests in `package.json` by adding a `test:viewer` script listing them, following the shape of the existing `test:agent` script.

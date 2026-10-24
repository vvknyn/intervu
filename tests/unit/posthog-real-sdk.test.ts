import { test } from "node:test";
import assert from "node:assert/strict";
import { POSTHOG_OPTIONS } from "../../src/lib/posthog-options";

// Runs the REAL posthog-js with POSTHOG_OPTIONS in a minimal fake browser that
// arrived from betalist.com on a tagged link, and reads what before_send gets
// (what the SDK built) and returns (what would be sent).

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// posthog-js starts timers that would keep the test process alive.
const unref = <A extends unknown[]>(start: (...a: A) => NodeJS.Timeout) => (...a: A) => start(...a).unref();

function installBrowser(href: string, referrer: string) {
  const u = new URL(href);
  const location = Object.assign(u, { assign() {}, replace() {}, reload() {} });
  const document = {
    referrer, URL: href, title: "Velai", cookie: "", location,
    readyState: "complete", documentElement: { clientWidth: 1200, style: {} },
    body: {}, head: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, style: {}, appendChild() {} }),
    getElementsByTagName: () => [], querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, removeEventListener() {}, hasFocus: () => true,
    visibilityState: "visible",
  };
  const win: Record<string, unknown> = {
    document, location, localStorage: fakeStorage(), sessionStorage: fakeStorage(),
    navigator: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", vendor: "Google Inc.", language: "en-US", sendBeacon: () => true },
    screen: { width: 1440, height: 900 }, innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
    addEventListener() {}, removeEventListener() {}, history: { pushState() {}, replaceState() {} },
    setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, fetch: async () => new Response("{}"),
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
  };
  win.window = win;
  Object.assign(globalThis, { setTimeout: win.setTimeout, setInterval: win.setInterval });
  Object.assign(globalThis, { window: win, document, location, localStorage: win.localStorage, sessionStorage: win.sessionStorage });
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
  return win;
}

test("real posthog-js: referrer, utm tags and click ids never leave before_send", async () => {
  installBrowser("https://velai.app/jobs?utm_source=x&gclid=y&fbclid=z&q=nurse", "https://www.google.com/search?q=nurse+jobs");
  const { default: posthog } = await import("posthog-js");
  const seen: { received: Record<string, unknown>[]; returned: Record<string, unknown>[] } = { received: [], returned: [] };
  posthog.init("phc_test", {
    ...POSTHOG_OPTIONS,
    api_host: "https://velai.app/ph",
    advanced_disable_flags: true,
    capture_pageview: false,
    capture_pageleave: false,
    before_send: (event) => {
      if (event) seen.received.push(JSON.parse(JSON.stringify({ ...event.properties, ...Object.fromEntries(Object.entries(event.$set_once ?? {})) })));
      const out = POSTHOG_OPTIONS.before_send as (e: unknown) => { properties: Record<string, unknown>; $set_once?: Record<string, unknown> } | null;
      const result = out(event);
      if (result) seen.returned.push(JSON.parse(JSON.stringify({ ...result.properties, ...(result.$set_once ?? {}) })));
      return null; // nothing leaves the test
    },
  } as never);
  posthog.capture("$pageview");

  assert.equal(seen.returned.length, 1, "one event went through before_send");
  const sentKeys = Object.keys(seen.returned[0]);
  const leak = /referr|utm_|gclid|fbclid|ph_keyword|search_engine|session_entry|initial_/i;
  assert.deepEqual(sentKeys.filter((k) => leak.test(k)), [], "no attribution key is returned");
  assert.equal(JSON.stringify(seen.returned[0]).match(/google\.com|nurse|gclid|fbclid|utm_source/), null, "no attribution value is returned");
  // The SDK switches do their part: it never registered these onto the event.
  for (const k of ["$referrer", "$referring_domain", "utm_source", "gclid", "fbclid"]) assert.equal(k in seen.received[0], false, `SDK still builds ${k}`);
  // Control: the SDK does build session-entry attribution that only before_send removes.
  assert.ok(Object.keys(seen.received[0]).some((k) => /^\$session_entry_/.test(k)), "control: SDK produced $session_entry_* props before before_send");
});

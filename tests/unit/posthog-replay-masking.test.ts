import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * /privacy promises that a session recording shows the shape of a page and
 * never its words. posthog-options.ts sets the masking; this proves it on the
 * REAL recorder: it bundles posthog-js + the recorder + POSTHOG_OPTIONS, loads
 * a page full of marker words in headless Chromium, and reads what the browser
 * POSTs to /ph/s/ (decompressing rrweb's gzip layers).
 *
 * The mocked PostHog config asks for everything a project setting can ask for
 * (console lines, request headers and bodies, no input masking): client options
 * must win. A control run with posthog-js's default masking must LEAK the
 * markers, or "absent" would prove nothing about the detector.
 *
 * Skips where there is no esbuild or no Chromium (a laptop and the journey
 * machines have both).
 */
const ROOT = join(__dirname, "../..");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const PAGE = `<!doctype html><html lang="en"><head><title>Senior Product Owner jobs SECRET_TITLE</title>
<style>body{color:#123;font-family:sans-serif} .box{border:1px solid #abc;padding:8px}</style></head>
<body><h1 id="h">Senior Product Owner at Acme Platform SECRET_H1</h1>
<p class="box">Résumé of Jane Doe jane.doe@example.com +1 555 0100 SECRET_PARA</p>
<input id="q" value="SECRET_INPUT_VALUE" placeholder="SECRET_PLACEHOLDER" aria-label="SECRET_ARIA">
<a id="a" href="/jobs?q=SECRET_HREF_QUERY&token=SECRET_HREF_TOKEN#SECRET_HASH" title="SECRET_TITLE_ATTR">Open job SECRET_LINK</a>
<img alt="SECRET_ALT" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">
<button id="b">Save SECRET_BUTTON</button><div id="slot"></div>
<script src="/bundle.js"></script></body></html>`;

const MARKERS = [
  "SECRET_TITLE", "SECRET_H1", "SECRET_PARA", "SECRET_INPUT_VALUE", "SECRET_PLACEHOLDER", "SECRET_ARIA",
  "SECRET_HREF_QUERY", "SECRET_HREF_TOKEN", "SECRET_HASH", "SECRET_TITLE_ATTR", "SECRET_LINK", "SECRET_ALT",
  "SECRET_BUTTON", "SECRET_QUERY", "SECRET_TOKEN", "SECRET_FRAG", "SECRET_TYPED", "SECRET_LATER_ADDED",
  "SECRET_LATER_TITLE", "Jane", "jane.doe", "Senior", "Acme", "Résumé",
];

const MUTATION_FIELDS = ["texts", "attributes", "removes", "adds"];
const unzip = (s: string): unknown => JSON.parse(gunzipSync(Buffer.from(s, "latin1")).toString("utf8"));

/** Every rrweb event of every POST to /ph/s/, one JSON string each, nested gzip layers opened. */
function decodeSnapshots(bodies: string[]): string[] {
  const out: string[] = [];
  for (const body of bodies) {
    const parsed = JSON.parse(body);
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
      for (const ev of event?.properties?.$snapshot_data ?? []) {
        if (ev.cv && typeof ev.data === "string") ev.data = unzip(ev.data);
        if (ev.data && typeof ev.data === "object") {
          for (const k of MUTATION_FIELDS) if (typeof ev.data[k] === "string") ev.data[k] = unzip(ev.data[k]);
        }
        out.push(JSON.stringify(ev));
      }
    }
  }
  return out;
}

async function record(control: boolean): Promise<string[] | "skip"> {
  let esbuild: typeof import("esbuild");
  let chromium: typeof import("playwright").chromium;
  try {
    esbuild = await import("esbuild");
    ({ chromium } = await import("playwright"));
  } catch {
    return "skip";
  }
  const bundle = (await esbuild.build({
    stdin: {
      loader: "ts",
      resolveDir: ROOT,
      contents: `
        import "posthog-js/dist/posthog-recorder";
        import posthog from "posthog-js";
        import { POSTHOG_OPTIONS } from "./src/lib/posthog-options";
        posthog.init("phc_test", {
          ...POSTHOG_OPTIONS,
          ...(${control} ? { session_recording: {} } : {}),
          api_host: location.origin + "/ph",
          opt_out_useragent_filter: true,
        } as never);`,
    },
    bundle: true, write: false, format: "iife", platform: "browser", absWorkingDir: ROOT,
    alias: { "@": join(ROOT, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  })).outputFiles[0].text;

  const posts: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/bundle.js") { res.setHeader("content-type", "text/javascript"); return void res.end(bundle); }
      if (url.pathname.startsWith("/ph/array") || url.pathname.startsWith("/ph/flags")) {
        // Everything a PostHog project can switch on: client options must still win.
        return void res.end(JSON.stringify({
          config: { enable_collect_everything: true },
          sessionRecording: {
            endpoint: "/s/", recorderVersion: "v2", consoleLogRecordingEnabled: true,
            networkPayloadCapture: { recordHeaders: true, recordBody: true }, masking: { maskAllInputs: false },
          },
          supportedCompression: ["gzip", "gzip-js"], featureFlags: {}, capturePerformance: true, errorsWhileComputingFlags: false,
        }));
      }
      if (url.pathname.startsWith("/ph/s")) {
        let body = Buffer.concat(chunks);
        try { body = gunzipSync(body); } catch { /* sent uncompressed */ }
        posts.push(body.toString("utf8"));
        return void res.end('{"status":1}');
      }
      if (url.pathname.startsWith("/ph/")) return void res.end('{"status":1}');
      res.setHeader("content-type", "text/html");
      res.end(PAGE);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  let browser;
  try {
    try {
      browser = await chromium.launch();
    } catch {
      browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
    }
  } catch {
    server.close();
    return "skip";
  }
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(`${origin}/jobs?q=SECRET_QUERY&token=SECRET_TOKEN#SECRET_FRAG`);
    await page.waitForTimeout(1500);
    await page.click("#b");
    await page.fill("#q", "SECRET_TYPED nurse");
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "SECRET_LATER_ADDED";
      p.setAttribute("title", "SECRET_LATER_TITLE");
      document.getElementById("slot")?.appendChild(p);
    });
    await page.waitForTimeout(1000);
    await page.goto(`${origin}/flush`); // leaving the page flushes the last batch
    await page.waitForTimeout(1500);
  } finally {
    await browser.close();
    server.close();
  }
  return decodeSnapshots(posts);
}

test("a recording of the real page holds no words, no field values and no query strings, but keeps its shape and clicks", { timeout: 90_000 }, async (t) => {
  const events = await record(false);
  if (events === "skip") return t.skip("no esbuild or no Chromium here");
  assert.ok(events.length > 0, "the recorder ran and posted snapshots to /ph/s/");
  const all = events.join("\n");

  assert.deepEqual(MARKERS.filter((m) => all.includes(m)), [], "words that reached a recording");

  // It still records something worth watching.
  assert.match(all, /"tagName":"h1"/, "page structure");
  assert.match(all, /"class":"box"/, "classes, so the replay looks like the page");
  assert.match(all, /"source":2,"type":2/, "a click");
  assert.match(all, /\*{6,}/, "text is starred out, not dropped");
  assert.ok(all.includes(`"href":"http://127.0.0.1:`) && !/"href":"[^"]*[?#]/.test(all), "every recorded address is without query or hash");
  assert.equal(events.some((e) => JSON.parse(e).type === 6), false, "no console or network plugin events, though the project asked for them");
});

test("control: with posthog-js's default masking the same page leaks, so the check above can see leaks", { timeout: 90_000 }, async (t) => {
  const events = await record(true);
  if (events === "skip") return t.skip("no esbuild or no Chromium here");
  const all = events.join("\n");
  for (const marker of ["SECRET_H1", "SECRET_INPUT_VALUE", "SECRET_PLACEHOLDER", "SECRET_HREF_QUERY", "SECRET_LATER_ADDED"]) {
    assert.ok(all.includes(marker), `control did not see ${marker}: the detector is blind`);
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { NOT_CONTACTED_HOSTS, NO_PERSONAL_DATA_HOSTS, PROCESSORS } from "../../src/lib/legal/processors";

/**
 * Fails closed on two things: a network address in src/ that /privacy does not
 * account for, and a package.json dependency nobody has classified.
 *
 * What the scan CANNOT see (so the rows for these are kept by hand):
 *  - hosts that arrive through env vars (database, Meilisearch, Subspace API,
 *    and overrides such as POSTHOG_API_HOST, POSTHOG_LOGS_ENDPOINT);
 *  - hosts built at runtime (`https://${x}`, a pasted URL, a fetched redirect);
 *  - hosts that live outside src/ (openclaw/, extension/, scripts/), or only
 *    in the Caddyfile that really runs in prod (the interview-os repo's);
 *  - what a dependency does at runtime; only its name is checked.
 * It reads every .ts/.tsx under src/ except tests, "use client" files included.
 */

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

const IMPORT_FROM = /\bfrom\s+["']([^"'.][^"']*)["']|\brequire\(\s*["']([^"'.][^"']*)["']\s*\)|\bimport\(\s*["']([^"'.][^"']*)["']\s*\)/g;
const DOTTED = "[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";
/** http(s)://, ws(s)://, stun:/stuns:/turn:/turns:, and a protocol-relative "//host" string literal. */
const NETWORK_LITERAL = new RegExp(`(?:https?|wss?)://(${DOTTED})|\\b(?:stuns?|turns?):(${DOTTED})|["'\`]//(${DOTTED})`, "g");

/** package.json dependencies with no outside network contact, and why. A dependency in neither this nor a PROCESSORS row fails the test. */
export const NO_THIRD_PARTY_NETWORK_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@modelcontextprotocol/server": "types for our own inbound MCP endpoint (src/app/api/mcp/route.ts); makes no outbound calls",
  "mcp-handler": "serves our own inbound MCP endpoint (src/app/api/mcp/route.ts)",
  "@phosphor-icons/react": "icon components bundled into our pages",
  "@radix-ui/react-dialog": "UI primitive, runs in the page",
  "@radix-ui/react-label": "UI primitive, runs in the page",
  "@radix-ui/react-popover": "UI primitive, runs in the page",
  "@radix-ui/react-scroll-area": "UI primitive, runs in the page",
  "@radix-ui/react-select": "UI primitive, runs in the page",
  "@radix-ui/react-separator": "UI primitive, runs in the page",
  "@radix-ui/react-slot": "UI primitive, runs in the page",
  "@radix-ui/react-tabs": "UI primitive, runs in the page",
  "@radix-ui/react-tooltip": "UI primitive, runs in the page",
  "radix-ui": "UI primitives, run in the page",
  "lucide-react": "icon components bundled into our pages",
  "class-variance-authority": "class-name helper, no I/O",
  "clsx": "class-name helper, no I/O",
  "tailwind-merge": "class-name helper, no I/O",
  "framer-motion": "animation, runs in the page",
  "cheerio": "parses HTML we already fetched (src/actions/fetch-url.ts); the fetch is the 'Websites you ask Velai to read or open' row",
  "docx": "builds a Word file in memory",
  "file-saver": "saves a file the browser already holds",
  "html2canvas": "draws the on-page résumé to an image in the browser (src/lib/export-resume-pdf.ts)",
  "jspdf": "builds a PDF in memory",
  "iron-session": "signs and reads our own cookie",
  "mailchecker": "offline list of throwaway email domains, no lookup",
  "mammoth": "reads a Word file, no network",
  "unpdf": "reads a PDF in the browser, no network",
  "markdown-it": "renders text to HTML, no I/O",
  "maxmind": "reads the db-ip country file shipped with us (src/lib/geo/ip-country.ts)",
  "pg": "talks to our own Postgres (host from env, the 'Our servers' row)",
  "tesseract.js": "OCR in the browser; worker, core and language files are served from our own /ocr path (src/lib/local-ai/ocr-pdf.ts:93-97)",
  "zod": "validation, no I/O",
  "next": "our web framework; NEXT_TELEMETRY_DISABLED=1 (Dockerfile:13,31); next/font/google downloads fonts at build time and we serve them",
  "react": "UI library",
  "react-dom": "UI library",
  // Declared but never imported under src/. The test below asserts that stays true; importing one forces a real classification.
  "@base-ui/react": "UNUSED: not imported under src/",
  "@google/generative-ai": "UNUSED: not imported under src/",
  "@monaco-editor/react": "UNUSED: not imported under src/",
  "@tesseract.js-data/eng": "UNUSED: not imported under src/ (its language data is copied to /ocr)",
  "@types/file-saver": "UNUSED: type declarations only",
  "firebase": "UNUSED: the browser SDK is not imported under src/",
  "motion": "UNUSED: not imported under src/",
  "react-hook-form": "UNUSED: not imported under src/",
  "tailwindcss-animate": "UNUSED: CSS plugin, not imported under src/",
  "use-debounce": "UNUSED: not imported under src/",
};

export interface Found {
  where: string;
  kind: "host" | "package";
  value: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Blank out comments, keeping every newline and offset so line numbers survive. */
export function stripComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\\])(\/\/[^\n]*)/g, (_, a: string, b: string) => a + blank(b));
}

/** Every network literal and bare package import in one source text (server or browser). */
export function scanText(file: string, text: string): Found[] {
  const code = stripComments(text);
  const line = (i: number) => code.slice(0, i).split("\n").length;
  const found: Found[] = [];
  for (const m of code.matchAll(IMPORT_FROM)) {
    found.push({ where: `${file}:${line(m.index!)}`, kind: "package", value: m[1] ?? m[2] ?? m[3] });
  }
  for (const m of code.matchAll(NETWORK_LITERAL)) {
    found.push({ where: `${file}:${line(m.index!)}`, kind: "host", value: (m[1] ?? m[2] ?? m[3]).toLowerCase() });
  }
  return found;
}

/** `reverse_proxy https://host` lines: the Caddy edge relays /ph to PostHog. */
export function scanCaddyfile(file: string, text: string): Found[] {
  return text.split("\n").flatMap((l, i) => {
    const m = /^\s*reverse_proxy\s+https?:\/\/([^\s/{]+)/.exec(l);
    return m ? [{ where: `${file}:${i + 1}`, kind: "host" as const, value: m[1].toLowerCase() }] : [];
  });
}

const hostMatches = (host: string, pattern: string) => host === pattern || host.endsWith(`.${pattern}`);
const packageMatches = (spec: string, pkg: string) => spec === pkg || spec.startsWith(pkg.endsWith("/") ? pkg : `${pkg}/`);

/** Every host Found that no processor row, NO_PERSONAL_DATA entry or NOT_CONTACTED entry accounts for. */
export function unaccountedHosts(found: readonly Found[]): Found[] {
  return found.filter(
    (f) =>
      f.kind === "host" &&
      !PROCESSORS.some((p) => p.hosts.some((h) => hostMatches(f.value, h))) &&
      !(f.value in NO_PERSONAL_DATA_HOSTS) &&
      !(f.value in NOT_CONTACTED_HOSTS),
  );
}

/** Dependencies that map to no processor row and have no no-network reason. */
export function unclassifiedDependencies(deps: readonly string[]): string[] {
  return deps.filter(
    (d) => !PROCESSORS.some((p) => p.packages.some((pkg) => packageMatches(d, pkg))) && !(d in NO_THIRD_PARTY_NETWORK_DEPENDENCIES),
  );
}

const dependencies = (): string[] => Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies);

function repoScan(): Found[] {
  const files = sourceFiles(SRC).flatMap((f) => scanText(f.slice(ROOT.length + 1), readFileSync(f, "utf8")));
  const caddy = "deploy/Caddyfile";
  return [...files, ...scanCaddyfile(caddy, readFileSync(join(ROOT, caddy), "utf8"))];
}

describe("every outside address and dependency is accounted for on /privacy", () => {
  const found = repoScan();

  it("the scan sees the services we know we call (it works)", () => {
    for (const host of ["api.workos.com", "openrouter.ai", "challenges.cloudflare.com", "us.i.posthog.com", "stun.l.google.com"]) {
      assert.ok(found.some((f) => f.kind === "host" && f.value === host), `scan missed ${host}`);
    }
    for (const pkg of ["stripe", "resend", "openai", "firebase-admin/firestore"]) {
      assert.ok(found.some((f) => f.kind === "package" && f.value === pkg), `scan missed ${pkg}`);
    }
  });

  it("no host in src is unaccounted for (fails closed, with file:line)", () => {
    const bad = unaccountedHosts(found).map((f) => `${f.where} ${f.value}`);
    assert.deepEqual(bad, [], `add a PROCESSORS row, or a reason in NO_PERSONAL_DATA_HOSTS / NOT_CONTACTED_HOSTS:\n${bad.join("\n")}`);
  });

  it("no package.json dependency is unclassified", () => {
    const bad = unclassifiedDependencies(dependencies());
    assert.deepEqual(bad, [], `map to a PROCESSORS row's packages, or give a reason in NO_THIRD_PARTY_NETWORK_DEPENDENCIES:\n${bad.join("\n")}`);
  });

  it("a dependency marked UNUSED is still not imported, and no classification is stale", () => {
    const imported = found.filter((f) => f.kind === "package").map((f) => f.value);
    const deps = dependencies();
    const wrong = Object.entries(NO_THIRD_PARTY_NETWORK_DEPENDENCIES).flatMap(([d, why]) => {
      if (!deps.includes(d)) return [`${d}: classified but not in package.json`];
      return why.startsWith("UNUSED") && imported.some((s) => packageMatches(s, d)) ? [`${d}: marked UNUSED but imported`] : [];
    });
    assert.deepEqual(wrong, []);
  });

  describe("fixtures: each gap the review found is caught", () => {
    const hit = (file: string, code: string) => unaccountedHosts(scanText(file, code)).map((f) => f.value);

    it("a host in a 'use client' file", () => {
      assert.deepEqual(hit("src/c.tsx", '"use client";\nconst u = "https://api.newvendor.io/x";'), ["api.newvendor.io"]);
    });
    it("a protocol-relative host", () => {
      assert.deepEqual(hit("src/f.ts", 'const u = "//cdn.newvendor.io/lib.js";'), ["cdn.newvendor.io"]);
    });
    it("a stun: and a turns: host", () => {
      assert.deepEqual(hit("src/f.ts", 'const c = [{ urls: "stun:stun.newvendor.io:3478" }, { urls: "turns:relay.newvendor.io" }];'), [
        "stun.newvendor.io",
        "relay.newvendor.io",
      ]);
    });
    it("a ws:// host in a file with no fetch call", () => {
      assert.deepEqual(hit("src/f.ts", 'export const SOCKET = "wss://live.newvendor.io/socket";'), ["live.newvendor.io"]);
    });
    it("a new dependency", () => {
      assert.deepEqual(unclassifiedDependencies(["stripe", "brand-new-sdk", "@workos-inc/node", "zod"]), ["brand-new-sdk"]);
    });
    it("a host added to the Caddyfile", () => {
      assert.equal(unaccountedHosts(scanCaddyfile("deploy/Caddyfile", "\thandle {\n\t\treverse_proxy https://logs.newvendor.io {\n")).length, 1);
    });
    it("ignores comments, and accepts a mapped host with its subdomains", () => {
      assert.equal(scanText("src/f.ts", '// fetch("https://evil.example")\nconst a = fetch(x);\n').filter((f) => f.kind === "host").length, 0);
      assert.equal(hit("src/f.ts", 'fetch("https://eu.api.workos.com/x")').length, 0);
    });
  });

  it("every host a row lists is still in the code, and every row package is still imported (no stale rows)", () => {
    const hosts = found.filter((f) => f.kind === "host").map((f) => f.value);
    const pkgs = found.filter((f) => f.kind === "package").map((f) => f.value);
    const stale: string[] = [];
    for (const p of PROCESSORS) {
      for (const h of p.hosts) if (!hosts.some((x) => hostMatches(x, h))) stale.push(`${p.name}: ${h}`);
      for (const pkg of p.packages) if (!pkgs.some((x) => packageMatches(x, pkg))) stale.push(`${p.name}: ${pkg}`);
    }
    assert.deepEqual(stale, []);
  });

  it("every NO_PERSONAL_DATA and NOT_CONTACTED entry gives a reason, is still in the code, and is in one table only", () => {
    const hosts = new Set(found.filter((f) => f.kind === "host").map((f) => f.value));
    for (const table of [NO_PERSONAL_DATA_HOSTS, NOT_CONTACTED_HOSTS]) {
      for (const [host, reason] of Object.entries(table)) {
        assert.ok(reason.trim().length > 10, `${host} needs a reason`);
        assert.ok(hosts.has(host), `${host} is classified but no longer appears in src`);
      }
    }
    for (const host of Object.keys(NO_PERSONAL_DATA_HOSTS)) assert.ok(!(host in NOT_CONTACTED_HOSTS), `${host} is in both tables`);
  });
});

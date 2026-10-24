import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { NO_PERSONAL_DATA_HOSTS, PROCESSORS } from "../../src/lib/legal/processors";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

/** SDK families that talk to an outside service. Any import of one must map to a processor. */
const SDK_IMPORT = /^(stripe|resend|openai|posthog|@workos-inc\/|firebase|@sentry|@vercel\/|@segment|mixpanel|@anthropic|@google|@aws-sdk|twilio|@sendgrid|nodemailer|@supabase|@upstash|@tinfoil|tinfoil)/;
const IMPORT_FROM = /\bfrom\s+["']([^"'.][^"']*)["']|\brequire\(\s*["']([^"'.][^"']*)["']\s*\)/g;
const ABSOLUTE_URL = /https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
/** Pages and files that only write links into content, not calls. Hosts there are checked only if the file also makes a call. */
const OUTBOUND_CALL = /\bfetch\w*\(|\bnew\s+(?:OpenAI|Resend|Stripe|WorkOS)\(|\bbaseURL\b|\bsendBeacon\(|\bEventSource\(|\bnew\s+WebSocket\(/;
const CLIENT_ONLY = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/;

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

/** Outbound hosts and SDK packages named in one server-side source text. */
export function scanText(file: string, text: string): Found[] {
  if (CLIENT_ONLY.test(text)) return [];
  const code = stripComments(text);
  const line = (i: number) => code.slice(0, i).split("\n").length;
  const found: Found[] = [];
  for (const m of code.matchAll(IMPORT_FROM)) {
    const spec = m[1] ?? m[2];
    if (SDK_IMPORT.test(spec)) found.push({ where: `${file}:${line(m.index!)}`, kind: "package", value: spec });
  }
  if (OUTBOUND_CALL.test(code)) {
    for (const m of code.matchAll(ABSOLUTE_URL)) found.push({ where: `${file}:${line(m.index!)}`, kind: "host", value: m[1].toLowerCase() });
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

/** Every Found that no processor row and no NO_PERSONAL_DATA entry accounts for. */
export function unaccounted(found: readonly Found[]): Found[] {
  return found.filter((f) =>
    f.kind === "host"
      ? !PROCESSORS.some((p) => p.hosts.some((h) => hostMatches(f.value, h))) && !(f.value in NO_PERSONAL_DATA_HOSTS)
      : !PROCESSORS.some((p) => p.packages.some((pkg) => f.value === pkg || f.value.startsWith(pkg.endsWith("/") ? pkg : `${pkg}/`))),
  );
}

function repoScan(): Found[] {
  const files = sourceFiles(SRC).flatMap((f) => scanText(f.slice(ROOT.length + 1), readFileSync(f, "utf8")));
  const caddy = "deploy/Caddyfile";
  return [...files, ...scanCaddyfile(caddy, readFileSync(join(ROOT, caddy), "utf8"))];
}

describe("every outside service server code reaches is listed on /privacy", () => {
  const found = repoScan();

  it("the scan sees the services we know we call (it works)", () => {
    for (const host of ["api.workos.com", "openrouter.ai", "challenges.cloudflare.com", "us.i.posthog.com"]) {
      assert.ok(found.some((f) => f.kind === "host" && f.value === host), `scan missed ${host}`);
    }
    for (const pkg of ["stripe", "resend", "openai", "firebase-admin/firestore"]) {
      assert.ok(found.some((f) => f.kind === "package" && f.value === pkg), `scan missed ${pkg}`);
    }
  });

  it("no host or SDK is unaccounted for (fails closed, with file:line)", () => {
    const bad = unaccounted(found).map((f) => `${f.where} ${f.kind} ${f.value}`);
    assert.deepEqual(bad, [], `add a row to PROCESSORS or a reason to NO_PERSONAL_DATA_HOSTS:\n${bad.join("\n")}`);
  });

  it("catches an unknown host in a fixture, in a file that calls fetch", () => {
    const hit = unaccounted(scanText("src/fixture.ts", 'const r = await fetch("https://api.newvendor-analytics.io/v1/track");'));
    assert.deepEqual(hit.map((f) => [f.where, f.value]), [["src/fixture.ts:1", "api.newvendor-analytics.io"]]);
  });

  it("catches an unknown SDK import, and a host added to the Caddyfile", () => {
    assert.equal(unaccounted(scanText("src/f.ts", 'import { Mixpanel } from "mixpanel";\n')).length, 1);
    assert.equal(unaccounted(scanCaddyfile("deploy/Caddyfile", "\thandle {\n\t\treverse_proxy https://logs.newvendor.io {\n")).length, 1);
  });

  it("ignores comments and client-only files, and accepts a mapped host with its subdomains", () => {
    assert.equal(scanText("src/f.ts", '// fetch("https://evil.example")\nconst a = fetch(x);\n').length, 0);
    assert.equal(scanText("src/c.tsx", '"use client";\nfetch("https://api.newvendor.io/x");').length, 0);
    assert.equal(unaccounted(scanText("src/f.ts", 'fetch("https://eu.api.workos.com/x")')).length, 0);
  });

  it("every host and package a row lists is still used in the code (no stale rows)", () => {
    const hosts = new Set(found.filter((f) => f.kind === "host").map((f) => f.value));
    const pkgs = found.filter((f) => f.kind === "package").map((f) => f.value);
    const stale: string[] = [];
    for (const p of PROCESSORS) {
      for (const h of p.hosts) if (![...hosts].some((x) => hostMatches(x, h))) stale.push(`${p.name}: ${h}`);
      for (const pkg of p.packages) if (!pkgs.some((x) => x === pkg || x.startsWith(pkg.endsWith("/") ? pkg : `${pkg}/`))) stale.push(`${p.name}: ${pkg}`);
    }
    assert.deepEqual(stale, []);
  });

  it("every NO_PERSONAL_DATA entry gives a reason", () => {
    for (const [host, reason] of Object.entries(NO_PERSONAL_DATA_HOSTS)) assert.ok(reason.trim().length > 10, `${host} needs a reason`);
  });
});

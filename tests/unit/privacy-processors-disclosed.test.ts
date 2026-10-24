import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import ts from "typescript";

import { LOG_ATTR_ALLOW_LIST } from "../../src/lib/observability/posthog-logs";
import { NOT_CONTACTED_HOSTS, NO_PERSONAL_DATA_HOSTS, PROCESSORS, type ScopedHost } from "../../src/lib/legal/processors";

/**
 * Fails closed on three things: a network address in src/ that /privacy does
 * not account for (for hosts without a processor row: in THAT file), an
 * imported package nobody has classified, and a log field nobody reviewed.
 *
 * Strings are read with the TypeScript parser, so a comment cannot hide a
 * string and a string cannot open a fake comment. CSS files are scanned for
 * url(...) and @import.
 *
 * What the scan CANNOT see (so the rows for these are kept by hand):
 *  - hosts that arrive through env vars (database, Meilisearch, Subspace API,
 *    and overrides such as POSTHOG_API_HOST, POSTHOG_LOGS_ENDPOINT);
 *  - an <img>/<link> whose address is data (a job's logo, a pasted URL, a
 *    redirect target): no literal names it. The browser-side gate for images
 *    is the Content-Security-Policy img-src 'self' data: blob: (a separate
 *    change), not this test;
 *  - everything outside src/: public/ (the install script, the OCR worker),
 *    openclaw/ (the laptop helper), extension/, scripts/, and the Caddyfile
 *    that really runs in prod (the interview-os repo's);
 *  - what a package does at runtime; only its name is checked.
 * A template/concatenation with a literal scheme and a computed host is
 * caught: its file must be in DYNAMIC_HOST_SITES with the exact number of
 * sites reviewed. An import()/require() with a computed argument fails.
 * Scheme and CSS function names are matched in any letter case, and
 * image-set() strings are read.
 * It reads every .ts/.tsx/.css under src/ except tests, "use client" files included.
 */

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

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

/**
 * Packages imported under src/ that are NOT in package.json dependencies (they
 * resolve from a transitive install), and why each is safe. An import of a
 * package in no list fails the test.
 */
export const UNDECLARED_IMPORTS: Readonly<Record<string, string>> = {
  playwright:
    "src/lib/resume/chrome-print-pdf.ts prints our own résumé HTML to PDF in headless Chromium; only scripts/ and tests import that file (no app route does), and the HTML (zip-html.ts, resume-zip.css.ts) holds no http(s) address, @import, image or link tag, so the browser it starts fetches nothing.",
};

const SRC_FILE = /\.(ts|tsx|css)$/;
const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));
const DOTTED = "[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";
/** A scheme://, with whatever follows it up to a separator (\0 marks a computed part of a template). */
const SCHEME_HOST = /\b((?:https?|wss?):\/\/)([^\s/?#\\"'`]*)/gi;
const STUN_HOST = new RegExp(`\\b(?:stuns?|turns?):(${DOTTED})`, "gi");
const PROTOCOL_RELATIVE = new RegExp(`^//(${DOTTED})`);
const HOST_ONLY = new RegExp(`^(?:[^@]*@)?(${DOTTED})(?::\\d+)?$`);
/** In CSS (any letter case): url(//host), url(https://host), @import "//host". */
const CSS_URL = new RegExp(`(?:url\\(\\s*|@import\\s+(?:url\\(\\s*)?)["']?(?:(?:https?:)?//)(${DOTTED})`, "gi");
/** image-set("//host/a.png" 1x, ...) takes bare strings, no url(). The whole call is read, so every candidate in it counts. */
const CSS_IMAGE_SET = /image-set\(([^)]*)\)/gi;
const CSS_ADDRESS = new RegExp(`["']\\s*(?:(?:https?:)?//)(${DOTTED})`, "gi");

export interface Found {
  where: string;
  file: string;
  kind: "host" | "package" | "dynamic-host" | "dynamic-import";
  value: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return SRC_FILE.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** The package an import specifier names ("@a/b/c" -> "@a/b", "x/y" -> "x"), or null for relative, alias and node: imports. */
export function packageOfSpecifier(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  const root = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return NODE_BUILTINS.has(root) ? null : root;
}

/** Hosts (or a computed-host marker) in one piece of string text. `piece` is a string literal value, or a template with \0 where a ${...} sits. */
function hostsInText(piece: string): { hosts: string[]; dynamic: boolean } {
  const hosts: string[] = [];
  let dynamic = false;
  for (const m of piece.matchAll(SCHEME_HOST)) {
    const raw = m[2];
    if (raw === "" || raw.includes("\0")) {
      dynamic = true;
      continue;
    }
    const host = HOST_ONLY.exec(raw)?.[1];
    if (host) hosts.push(host.toLowerCase());
  }
  for (const m of piece.matchAll(STUN_HOST)) hosts.push(m[1].toLowerCase());
  const rel = PROTOCOL_RELATIVE.exec(piece);
  if (rel) hosts.push(rel[1].toLowerCase());
  return { hosts, dynamic };
}

/** Every network literal and bare package import in one TypeScript/TSX text, read from the syntax tree (comments are not code; strings are). */
export function scanText(file: string, text: string): Found[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Found[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const addPackage = (n: ts.Node, spec: string) => {
    const pkg = packageOfSpecifier(spec);
    if (pkg) found.push({ where: at(n), file, kind: "package", value: spec });
  };
  const addText = (n: ts.Node, piece: string) => {
    const { hosts, dynamic } = hostsInText(piece);
    for (const value of hosts) found.push({ where: at(n), file, kind: "host", value });
    if (dynamic) found.push({ where: at(n), file, kind: "dynamic-host", value: piece.replace(/\0/g, "${}") });
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      addPackage(n, n.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      addPackage(n, n.moduleReference.expression.text);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      addPackage(n, n.argument.literal.text);
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const arg = n.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) addPackage(n, arg.text);
      else found.push({ where: at(n), file, kind: "dynamic-import", value: arg ? arg.getText(sf) : "" });
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) addText(n, n.text);
    else if (ts.isTemplateExpression(n)) addText(n, [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("\0"));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Hosts in a stylesheet: url(...) and @import. CSS has one comment form (slash-star), so blanking those first is exact. */
export function scanCss(file: string, text: string): Found[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const hit = (index: number, host: string) => ({ where: `${file}:${code.slice(0, index).split("\n").length}`, file, kind: "host" as const, value: host.toLowerCase() });
  const inImageSet = [...code.matchAll(CSS_IMAGE_SET)].flatMap((set) => [...set[1].matchAll(CSS_ADDRESS)].map((m) => hit(set.index, m[1])));
  const seen = new Set<string>();
  return [...[...code.matchAll(CSS_URL)].map((m) => hit(m.index, m[1])), ...inImageSet].filter((f) => {
    const key = `${f.where} ${f.value}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** `reverse_proxy https://host` lines: the Caddy edge relays /ph to PostHog. */
export function scanCaddyfile(file: string, text: string): Found[] {
  return text.split("\n").flatMap((l, i) => {
    const m = /^\s*reverse_proxy\s+https?:\/\/([^\s/{]+)/.exec(l);
    return m ? [{ where: `${file}:${i + 1}`, file, kind: "host" as const, value: m[1].toLowerCase() }] : [];
  });
}

const hostMatches = (host: string, pattern: string) => host === pattern || host.endsWith(`.${pattern}`);
const packageMatches = (spec: string, pkg: string) => spec === pkg || spec.startsWith(pkg.endsWith("/") ? pkg : `${pkg}/`);
const scopedTo = (table: Readonly<Record<string, ScopedHost>>, host: string, file: string) => table[host]?.files.includes(file) === true;

/** Every host Found that no processor row accounts for, and no NO_PERSONAL_DATA / NOT_CONTACTED entry accounts for in that file. */
export function unaccountedHosts(found: readonly Found[]): Found[] {
  return found.filter(
    (f) =>
      f.kind === "host" &&
      !PROCESSORS.some((p) => p.hosts.some((h) => hostMatches(f.value, h))) &&
      !scopedTo(NO_PERSONAL_DATA_HOSTS, f.value, f.file) &&
      !scopedTo(NOT_CONTACTED_HOSTS, f.value, f.file),
  );
}

/** Template/concatenation sites with a literal scheme and a computed host: each file needs a reviewed reason here and the number of sites reviewed in it, so a new one in a listed file fails too. */
export const DYNAMIC_HOST_SITES: Readonly<Record<string, { sites: number; why: string }>> = {
  "src/components/company/CompanySections.tsx": { sites: 1, why: "a link to the company's own website (href=https://domain) that you click; our server and page never request it." },
  "src/lib/analytics/ai-generation.ts": { sites: 2, why: "a check that a configured address starts with http:// or https://; not a request." },
  "src/lib/seo/jsonld.ts": { sites: 1, why: "the company url field written into page markup (https://domain); nothing fetches it." },
  "src/lib/server-warm-up.ts": { sites: 1, why: "our own server calling itself on a loopback address (127.0.0.1 or the host it listens on) after start, at the address it listens on (127.0.0.1 unless HOSTNAME says otherwise)." },
};

export function unreviewedDynamicHosts(found: readonly Found[]): Found[] {
  const sites = found.filter((f) => f.kind === "dynamic-host");
  return sites.filter((f) => DYNAMIC_HOST_SITES[f.file]?.sites !== sites.filter((o) => o.file === f.file).length);
}

/** import()/require() calls whose argument is not a string literal: the package they load cannot be classified. */
export function nonLiteralImports(found: readonly Found[]): Found[] {
  return found.filter((f) => f.kind === "dynamic-import");
}

/** Imported packages that are no processor row's package, no no-network dependency, no reviewed undeclared import, and not a node builtin. */
export function unclassifiedImports(found: readonly Found[]): Found[] {
  return found.filter((f) => {
    if (f.kind !== "package") return false;
    const root = packageOfSpecifier(f.value)!;
    return (
      !PROCESSORS.some((p) => p.packages.some((pkg) => packageMatches(f.value, pkg))) &&
      !(root in NO_THIRD_PARTY_NETWORK_DEPENDENCIES) &&
      !(root in UNDECLARED_IMPORTS)
    );
  });
}

/** Dependencies that map to no processor row and have no no-network reason. */
export function unclassifiedDependencies(deps: readonly string[]): string[] {
  return deps.filter(
    (d) => !PROCESSORS.some((p) => p.packages.some((pkg) => packageMatches(d, pkg))) && !(d in NO_THIRD_PARTY_NETWORK_DEPENDENCIES),
  );
}

const dependencies = (): string[] => Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies);

function scanFile(path: string): Found[] {
  const rel = path.slice(ROOT.length + 1);
  const text = readFileSync(path, "utf8");
  return path.endsWith(".css") ? scanCss(rel, text) : scanText(rel, text);
}

function repoScan(): Found[] {
  const caddy = "deploy/Caddyfile";
  return [...sourceFiles(SRC).flatMap(scanFile), ...scanCaddyfile(caddy, readFileSync(join(ROOT, caddy), "utf8"))];
}

/** The log fields reviewed for /privacy. Adding or removing a field in LOG_ATTR_ALLOW_LIST fails the test below until this list, and the PostHog row's log sentence, are reviewed. */
const REVIEWED_LOG_ATTRS: readonly string[] = [
  "reason", "form", "turnstile_reason", "email_reason",
  "error_name", "error_status", "error_codes", "error.type", "error.digest",
  "step", "duration_ms", "had_session", "outcome", "claimed",
  "http.request.method", "http.route", "next.route_type", "next.router_kind",
  "search.ms", "search.engine.ms", "search.calls", "budget.ms", "news.ms", "events.ms", "box.ms",
  "left.off", "company.domain", "process.uptime_s", "warm_up.pages",
];

describe("every outside address and dependency is accounted for on /privacy", () => {
  const found = repoScan();

  it("the scan sees the services we know we call (it works)", () => {
    for (const host of ["api.workos.com", "openrouter.ai", "challenges.cloudflare.com", "us.i.posthog.com", "stun.l.google.com"]) {
      assert.ok(found.some((f) => f.kind === "host" && f.value === host), `scan missed ${host}`);
    }
    for (const pkg of ["stripe", "resend", "openai", "firebase-admin/firestore", "tinfoil", "playwright"]) {
      assert.ok(found.some((f) => f.kind === "package" && f.value === pkg), `scan missed ${pkg}`);
    }
  });

  it("no host in src is unaccounted for (fails closed, with file:line)", () => {
    const bad = unaccountedHosts(found).map((f) => `${f.where} ${f.value}`);
    assert.deepEqual(bad, [], `add a PROCESSORS row, or list the file in NO_PERSONAL_DATA_HOSTS / NOT_CONTACTED_HOSTS with a reason:\n${bad.join("\n")}`);
  });

  it("no computed-host address is unreviewed", () => {
    const bad = unreviewedDynamicHosts(found).map((f) => `${f.where} ${f.value}`);
    assert.deepEqual(bad, [], `review where the host comes from, then add the file to DYNAMIC_HOST_SITES (or fix its pinned number of sites):\n${bad.join("\n")}`);
    for (const [file, { why }] of Object.entries(DYNAMIC_HOST_SITES)) {
      assert.ok(why.trim().length > 10, `${file} needs a reason`);
      assert.ok(found.some((f) => f.kind === "dynamic-host" && f.file === file), `${file} is listed but has no computed-host address any more`);
    }
  });

  it("no import() or require() takes a computed argument", () => {
    const bad = nonLiteralImports(found).map((f) => `${f.where} ${f.value}`);
    assert.deepEqual(bad, [], `a package loaded by a computed name cannot be classified; use a literal specifier:\n${bad.join("\n")}`);
  });

  it("every imported package is a node builtin or classified", () => {
    const bad = unclassifiedImports(found).map((f) => `${f.where} ${f.value}`);
    assert.deepEqual(bad, [], `map to a PROCESSORS row's packages, NO_THIRD_PARTY_NETWORK_DEPENDENCIES, or UNDECLARED_IMPORTS:\n${bad.join("\n")}`);
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
    for (const pkg of Object.keys(UNDECLARED_IMPORTS)) {
      if (deps.includes(pkg)) wrong.push(`${pkg}: in UNDECLARED_IMPORTS but declared in package.json`);
      if (!imported.some((s) => packageMatches(s, pkg))) wrong.push(`${pkg}: in UNDECLARED_IMPORTS but no longer imported`);
    }
    assert.deepEqual(wrong, []);
  });

  it("the server-log fields are the reviewed list", () => {
    assert.deepEqual([...LOG_ATTR_ALLOW_LIST], [...REVIEWED_LOG_ATTRS], "a log field was added or removed: review the PostHog row's log sentence, then update REVIEWED_LOG_ATTRS");
  });

  describe("fixtures: each gap the reviews found is caught", () => {
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
    it("a host added to a template literal with a static host", () => {
      assert.deepEqual(hit("src/f.ts", "const u = `https://api.newvendor.io/${id}`;"), ["api.newvendor.io"]);
    });
    it("a new dependency", () => {
      assert.deepEqual(unclassifiedDependencies(["stripe", "brand-new-sdk", "@workos-inc/node", "zod"]), ["brand-new-sdk"]);
    });
    it("a host added to the Caddyfile", () => {
      assert.equal(unaccountedHosts(scanCaddyfile("deploy/Caddyfile", "\thandle {\n\t\treverse_proxy https://logs.newvendor.io {\n")).length, 1);
    });
    it("comments are ignored, and a mapped host is accepted with its subdomains", () => {
      assert.equal(scanText("src/f.ts", '// fetch("https://evil.example")\n/* "https://evil.example" */\nconst a = fetch(x);\n').filter((f) => f.kind === "host").length, 0);
      assert.equal(hit("src/f.ts", 'fetch("https://eu.api.workos.com/x")').length, 0);
    });

    // Review 2 gaps (a-e).
    it("a comment opener inside a string does not swallow the host after it", () => {
      assert.deepEqual(hit("src/f.ts", 'const glob = "src/**/*.ts"; /* x */ const u = "/*"; fetch("https://api.newvendor.io/x"); const e = "*/";'), ["api.newvendor.io"]);
      assert.deepEqual(hit("src/f.ts", 'const a = "http:"; // trailing "quote\nfetch("https://api.newvendor.io/x");'), ["api.newvendor.io"]);
    });
    it("a template literal with a literal scheme and a computed host is flagged until reviewed", () => {
      for (const code of ["fetch(`https://${host}/x`);", "fetch(`https://api.${region}.newvendor.io/x`);", 'fetch("https://" + host);']) {
        const dyn = unreviewedDynamicHosts(scanText("src/lib/new-file.ts", code));
        assert.equal(dyn.length, 1, code);
      }
      assert.equal(unreviewedDynamicHosts(scanText("src/lib/new-file.ts", "fetch(`${origin}/api/x`);")).length, 0);
    });
    it("a known no-data host in a file that is not listed for it fails", () => {
      assert.deepEqual(hit("src/lib/new-file.ts", 'fetch("https://www.google.com/s2/favicons")'), ["www.google.com"]);
      assert.deepEqual(hit("src/lib/new-file.ts", 'const u = "https://claude.ai/new";'), ["claude.ai"]);
      const [host, entry] = Object.entries(NOT_CONTACTED_HOSTS)[0];
      assert.deepEqual(hit(entry.files[0], `const u = "https://${host}/x";`), []);
    });
    it("an import of a package that is not a dependency and not classified fails", () => {
      const bad = (code: string) => unclassifiedImports(scanText("src/f.ts", code)).map((f) => f.value);
      assert.deepEqual(bad('import { chromium } from "undeclared-browser";'), ["undeclared-browser"]);
      assert.deepEqual(bad('const m = await import("@scope/other/sub");'), ["@scope/other/sub"]);
      assert.deepEqual(bad('const r = require("sneaky-pkg");'), ["sneaky-pkg"]);
      assert.deepEqual(bad('export * from "re-exported";'), ["re-exported"]);
      assert.deepEqual(bad('import("node:fs"); import "fs"; import x from "./local"; import y from "@/lib/z"; import z from "zod/v4";'), []);
    });
    it("an upper- or mixed-case scheme is still a scheme", () => {
      assert.deepEqual(hit("src/f.ts", 'fetch("HTTPS://API.NewVendor.io/x"); const s = "Wss://live.newvendor.io"; const t = "STUN:stun.newvendor.io";'), [
        "api.newvendor.io",
        "live.newvendor.io",
        "stun.newvendor.io",
      ]);
    });
    it("a new computed-host site in a file that is already listed fails (the number of sites is pinned)", () => {
      const [file, { sites }] = Object.entries(DYNAMIC_HOST_SITES)[0];
      const site = (n: number) => Array.from({ length: n }, (_, i) => `fetch(\`https://\${h${i}}/x\`);`).join("\n");
      assert.equal(unreviewedDynamicHosts(scanText(file, site(sites))).length, 0);
      assert.equal(unreviewedDynamicHosts(scanText(file, site(sites + 1))).length, sites + 1);
    });
    it("an import() or require() with a computed argument fails", () => {
      const bad = (code: string) => nonLiteralImports(scanText("src/f.ts", code)).map((f) => f.value);
      assert.deepEqual(bad("const m = await import(name);"), ["name"]);
      assert.deepEqual(bad("const m = require(`pkg-${x}`);"), ["`pkg-${x}`"]);
      assert.deepEqual(bad('const m = await import("zod"); const r = require("zod");'), []);
    });
    it("a host in a stylesheet fails in any letter case and inside image-set()", () => {
      const css = '.a { background: URL(//cdn.newvendor.io/a.png); }\n@IMPORT "//fonts.newvendor.io/c.css";\n.b { background-image: -webkit-image-set("//img.newvendor.io/a.png" 1x, "https://img2.newvendor.io/b.png" 2x); }\n.c { background: IMAGE-SET(url(//img3.newvendor.io/c.png) 1x); }';
      assert.deepEqual(unaccountedHosts(scanCss("src/app/x.css", css)).map((f) => f.value).sort(), ["cdn.newvendor.io", "fonts.newvendor.io", "img.newvendor.io", "img2.newvendor.io", "img3.newvendor.io"]);
    });
    it("a host in a stylesheet fails", () => {
      const css = '@import url("https://fonts.newvendor.io/css");\n.a { background: url(//cdn.newvendor.io/a.png); }\n/* url(https://commented.io/x) */\n.b { background: url(data:image/png;base64,AA); }';
      assert.deepEqual(unaccountedHosts(scanCss("src/app/x.css", css)).map((f) => f.value), ["fonts.newvendor.io", "cdn.newvendor.io"]);
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

  it("every NO_PERSONAL_DATA and NOT_CONTACTED entry gives a reason, lists real files, and is in one table only", () => {
    for (const table of [NO_PERSONAL_DATA_HOSTS, NOT_CONTACTED_HOSTS]) {
      for (const [host, entry] of Object.entries(table)) {
        assert.ok(entry.reason.trim().length > 10, `${host} needs a reason`);
        assert.ok(entry.files.length > 0, `${host} needs at least one file`);
        for (const file of entry.files) {
          assert.ok(found.some((f) => f.kind === "host" && f.value === host && f.file === file), `${host} is listed for ${file} but does not appear there`);
        }
      }
    }
    for (const host of Object.keys(NO_PERSONAL_DATA_HOSTS)) assert.ok(!(host in NOT_CONTACTED_HOSTS), `${host} is in both tables`);
  });
});

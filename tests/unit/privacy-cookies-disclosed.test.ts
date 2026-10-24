import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { COOKIES_DISCLOSED } from "../../src/lib/legal/cookies-disclosed";

const SRC = join(__dirname, "../../src");
const AUTHKIT = join(__dirname, "../../node_modules/@workos-inc/authkit-nextjs/dist/esm");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** `const SOMETHING_COOKIE... = "name"`: the name of every cookie declared as a constant. */
const COOKIE_CONSTANT = /\b(?:const|let)\s+([A-Z][A-Z0-9_]*COOKIE[A-Z0-9_]*)\s*=\s*["']([^"']+)["']/g;
/** A cookie-store write: `.set("name", ...)` or the object form `.set({ name: "name", ... })`; group 1 is the name expression. */
const COOKIE_WRITE = /(?:cookies\(\)|cookieStore|cookies)\.set\(\s*(?:\{\s*name\s*:\s*)?([^,)}\n]+)/g;
/** A raw write: a Set-Cookie header (append/set/object/tuple) or `document.cookie =`; group 1 is the rest of the line. */
const RAW_WRITE = /(?:["'`]set-cookie["'`]\s*[,:]|document\.cookie\s*=(?!=))\s*([^\n]+)/gi;

const disclosed = new Set(COOKIES_DISCLOSED.map((c) => c.name));

type SourceFile = { file: string; text: string };

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(?<!:)\/\/.*$/gm, "");

/** Cookie names a raw-write value names: `"name=..."`, `\`${CONST}=...\``, or a call to a function whose body does. */
function rawName(expr: string, constants: Map<string, string>, files: SourceFile[]): string | undefined {
  const inline = (code: string) => {
    const c = /["'`]\$\{(\w+)\}=/.exec(code);
    if (c) return constants.get(c[1]);
    return /^["'`]([\w.-]+)=/.exec(code.trim())?.[1];
  };
  const call = /^([A-Za-z_]\w*)\(/.exec(expr.trim());
  if (!call) return inline(expr);
  for (const { text } of files) {
    const body = new RegExp(`function ${call[1]}\\b[\\s\\S]*?\\n\\}`).exec(text)?.[0];
    if (body) return inline(body);
  }
}

/** Every cookie write in `files`: the names it resolves, and file:line of each write whose name it cannot resolve (fail closed). */
export function scanCookieWrites(rawFiles: SourceFile[]): { names: Map<string, string>; unresolved: string[] } {
  const files = rawFiles.map(({ file, text }) => ({ file, text: stripComments(text) }));
  const constants = new Map<string, string>();
  for (const { text } of files) for (const m of text.matchAll(COOKIE_CONSTANT)) constants.set(m[1], m[2]);
  const names = new Map<string, string>();
  const unresolved: string[] = [];
  for (const { file, text } of files) {
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;
    const record = (name: string | undefined, index: number, expr: string) => {
      if (name) names.set(name, file);
      else unresolved.push(`${file}:${lineOf(index)}: ${expr.trim()}`);
    };
    for (const m of text.matchAll(COOKIE_WRITE)) {
      const arg = m[1].trim();
      record(/^["']/.test(arg) ? arg.slice(1, -1) : constants.get(arg), m.index!, arg);
    }
    for (const m of text.matchAll(RAW_WRITE)) record(rawName(m[1], constants, files), m.index!, m[1]);
  }
  return { names, unresolved };
}

function cookieNamesSetInSrc() {
  return scanCookieWrites(sourceFiles(SRC).map((f) => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") })));
}

describe("every cookie Velai sets is listed on /privacy", () => {
  const scan = cookieNamesSetInSrc();

  it("finds the cookies we know we set (the scan itself works)", () => {
    for (const known of ["intervu_contact", "intervu_email_code", "intervu_signup_completed", "sb_jobs_visitor"]) {
      assert.ok(scan.names.has(known), `scan missed ${known}`);
    }
  });

  it("no cookie name set in src is missing from the privacy page list", () => {
    const missing = [...scan.names].filter(([name]) => !disclosed.has(name)).map(([name, file]) => `${name} (${file})`);
    assert.deepEqual(missing, [], "cookie set in src but not in COOKIES_DISCLOSED (src/lib/legal/cookies-disclosed.ts)");
  });

  it("every cookie write names its cookie by a literal or a *_COOKIE* constant, so the scan can read it", () => {
    assert.deepEqual(scan.unresolved, []);
  });

  it("the scan reads the object form and raw Set-Cookie writes, and fails closed on a name it cannot read", () => {
    const f = (text: string) => scanCookieWrites([{ file: "x.ts", text: `const A_COOKIE = "a_c";\n${text}` }]);
    for (const [text, name] of [
      [`cookies.set({ name: "o1", value: v });`, "o1"],
      [`response.cookies.set({\n name: A_COOKIE,\n value: v })`, "a_c"],
      [`headers.append("Set-Cookie", "h1=v; Path=/");`, "h1"],
      ["res.headers.set('set-cookie', `${A_COOKIE}=v`);", "a_c"],
      [`new Headers({ "Set-Cookie": "h2=v" })`, "h2"],
      [`document.cookie = "d1=v";`, "d1"],
    ]) assert.ok(f(text).names.has(name), text);
    for (const text of [
      `cookies.set(dynamicName, v);`,
      `cookies.set({ ...opts });`,
      `cookies.set({ name: pick(), value: v });`,
      `headers.append("Set-Cookie", header);`,
      "document.cookie = `${name}=v`;",
      `document.cookie = build(name);`,
    ]) assert.equal(f(text).unresolved.length, 1, text);
    assert.match(f(`\n\ndocument.cookie = x;`).unresolved[0], /^x\.ts:4:/);
  });

  it("the cookies AuthKit sets for us are listed, under the names the installed package uses", () => {
    const cookieJs = readFileSync(join(AUTHKIT, "session.js"), "utf8") + readFileSync(join(AUTHKIT, "pkce.js"), "utf8");
    for (const name of ["wos-session", "wos-auth-verifier"]) {
      assert.ok(cookieJs.includes(`'${name}'`), `installed AuthKit no longer uses ${name}`);
      assert.ok(disclosed.has(name), `${name} not disclosed`);
    }
  });

  it("every disclosed cookie has a purpose and a lifetime, and the list has no duplicates", () => {
    assert.equal(disclosed.size, COOKIES_DISCLOSED.length);
    for (const c of COOKIES_DISCLOSED) assert.ok(c.purpose.length > 20 && c.lifetime.length > 0, c.name);
  });

  it("the privacy page renders the list and no longer claims a fixed number of cookies", () => {
    const page = readFileSync(join(SRC, "app/privacy/page.tsx"), "utf8");
    assert.match(page, /COOKIES_DISCLOSED\.map/);
    assert.doesNotMatch(page, /the two cookies|one more tiny cookie/);
  });
});

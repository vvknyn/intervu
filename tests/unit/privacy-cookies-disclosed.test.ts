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
/** A write to a cookie store, with its first argument. */
const COOKIE_WRITE = /(?:cookies\(\)|cookieStore|cookies)\.set\(\s*([A-Za-z_][\w]*|["'][^"']+["'])/g;
/** A raw write: document.cookie = ..., or a Set-Cookie header. */
const RAW_WRITE = /document\.cookie\s*=|Set-Cookie/i;

const disclosed = new Set(COOKIES_DISCLOSED.map((c) => c.name));

function cookieNamesSetInSrc(): { names: Map<string, string>; unresolved: string[]; rawWriteFiles: string[] } {
  const files = sourceFiles(SRC).map((f) => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }));
  const constants = new Map<string, string>();
  for (const { text } of files) for (const m of text.matchAll(COOKIE_CONSTANT)) constants.set(m[1], m[2]);
  const names = new Map<string, string>();
  const unresolved: string[] = [];
  const rawWriteFiles: string[] = [];
  for (const { file, text } of files) {
    for (const m of text.matchAll(COOKIE_WRITE)) {
      const arg = m[1];
      const name = /^["']/.test(arg) ? arg.slice(1, -1) : constants.get(arg);
      if (name) names.set(name, file);
      else unresolved.push(`${file}: ${arg}`);
    }
    if (RAW_WRITE.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) rawWriteFiles.push(file);
  }
  // Raw writers name their cookie through a constant in the same file or one they import.
  for (const { file, text } of files) {
    if (!rawWriteFiles.includes(file)) continue;
    for (const [constName, value] of constants) if (new RegExp(`\\b${constName}\\b`).test(text)) names.set(value, file);
  }
  return { names, unresolved, rawWriteFiles };
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

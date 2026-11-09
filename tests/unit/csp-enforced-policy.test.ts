import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig, {
  CONTENT_SECURITY_POLICY,
  CSP_REPORT_ENDPOINT,
  CSP_REPORT_PATH,
  ENFORCED_POLICY,
} from "../../next.config";

const directives = (policy: string) => policy.split(";").map((d) => d.trim().split(/\s+/));
const directive = (policy: string, name: string) => directives(policy).find(([n]) => n === name)?.slice(1);

async function catchAllHeaders() {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "a catch-all header rule exists");
  return all.headers;
}

// The remote-image class is closed at the browser: an ENFORCED img-src that
// names no remote host. Read from the headers Next really serves, for every path.
test("every route is served the enforced policy, and its img-src names no remote host", async () => {
  const enforced = (await catchAllHeaders()).filter((h) => h.key === "Content-Security-Policy");
  assert.deepEqual(enforced.map((h) => h.value), [ENFORCED_POLICY]);
  assert.deepEqual(directive(ENFORCED_POLICY, "img-src"), ["'self'", "data:", "blob:"]);
  assert.doesNotMatch(directive(ENFORCED_POLICY, "img-src")!.join(" "), /https?:|\*/);
});

// The enforced policy may only forbid what the app does not use, or it breaks the
// page it guards. Pinned both ways: the set of directives, and the source scan.
test("the enforced policy is exactly the four directives nothing in src/ depends on", () => {
  assert.deepEqual(directives(ENFORCED_POLICY).map(([n]) => n), ["img-src", "object-src", "base-uri", "frame-ancestors"]);
  assert.deepEqual(directive(ENFORCED_POLICY, "object-src"), ["'none'"]);
  assert.deepEqual(directive(ENFORCED_POLICY, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(ENFORCED_POLICY, "frame-ancestors"), ["'none'"]);
  for (const risky of ["script-src", "style-src", "connect-src", "form-action", "default-src"]) {
    assert.equal(directive(ENFORCED_POLICY, risky), undefined, `${risky} must stay report-only until reports are clean`);
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(tsx|jsx|html)$/.test(e.name) ? [full] : [];
  });
}

test("nothing under src/ renders a <object>, <embed> or <base> (what object-src and base-uri forbid)", () => {
  const offenders = sourceFiles(join(process.cwd(), "src")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/<(object|embed|base)[\s>/]/g)].map((m) => `${file}: <${m[1]}`),
  );
  assert.deepEqual(offenders, []);
});

test("the report-only policy tells the browser where to send violations", async () => {
  assert.equal(CSP_REPORT_PATH, "/api/csp-report");
  assert.deepEqual(directive(CONTENT_SECURITY_POLICY, "report-uri"), [CSP_REPORT_PATH]);
  assert.deepEqual(directive(CONTENT_SECURITY_POLICY, "report-to"), [CSP_REPORT_ENDPOINT]);
  const headers = await catchAllHeaders();
  assert.equal(headers.find((h) => h.key === "Reporting-Endpoints")?.value, `${CSP_REPORT_ENDPOINT}="${CSP_REPORT_PATH}"`);
  assert.equal(headers.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value, CONTENT_SECURITY_POLICY);
});

test("un-hashed public media is cached for a month, never max-age=0, never immutable", async () => {
  const { PUBLIC_MEDIA_CACHE_CONTROL, PUBLIC_MEDIA_EXTENSIONS, PUBLIC_MEDIA_SOURCE } = await import("../../next.config");
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === PUBLIC_MEDIA_SOURCE);
  assert.ok(rule, "a public-media cache rule exists");
  // The rule must not touch Next's own content-hashed files, which are immutable for a year.
  const matches = (path: string) => new RegExp(`^${PUBLIC_MEDIA_SOURCE}$`).test(path);
  assert.ok(matches("/velai-tile.png"));
  assert.ok(matches("/blog/is-velai-legit/checks.png"));
  assert.ok(matches("/fonts/liberation/LiberationSans-Regular.ttf"));
  assert.ok(!matches("/_next/static/media/47df9ba1c7236d3b-s.p.woff2"));
  assert.ok(!matches("/_next/static/chunks/a.png"));
  assert.ok(!matches("/ocr/core.wasm"));
  for (const ext of ["png", "jpg", "svg", "woff2", "mp4"]) assert.ok(PUBLIC_MEDIA_EXTENSIONS.includes(ext as never), ext);
  assert.equal(rule.headers.find((h) => h.key === "Cache-Control")?.value, PUBLIC_MEDIA_CACHE_CONTROL);
  assert.match(PUBLIC_MEDIA_CACHE_CONTROL, /max-age=(\d+)/);
  assert.ok(Number(/max-age=(\d+)/.exec(PUBLIC_MEDIA_CACHE_CONTROL)![1]) >= 30 * 24 * 3600);
  assert.doesNotMatch(PUBLIC_MEDIA_CACHE_CONTROL, /immutable/);
  // public/ocr changes in place on a dependency bump (its .js and .wasm must change together): never matched.
  for (const ext of ["js", "wasm", "gz", "txt", "html", "json"]) assert.ok(!PUBLIC_MEDIA_EXTENSIONS.includes(ext as never), ext);
});

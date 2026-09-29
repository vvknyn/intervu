import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_SECURITY_POLICY } from "../../next.config";

/**
 * Gate: every third-party origin src/ loads a script from is listed in the
 * CSP's script-src. The origins are read from the source, not from a list kept
 * here, so a new <Script src>, `el.src = "https://…"`, or `https://…/x.js`
 * literal fails this test until next.config.ts allows its origin.
 */
const SCRIPT_ORIGIN_PATTERNS: RegExp[] = [
    /<script\b[^<]{0,600}?\bsrc\s*=\s*\{?\s*["'`](https?:\/\/[^/"'`\s]+)/gi,
    /["'`](https?:\/\/[^/"'`\s]+)\/[^"'`\s]*\.m?js(?:\?[^"'`\s]*)?["'`]/g,
    /\.src\s*=\s*["'`](https?:\/\/[^/"'`\s]+)/g,
];

/** Pure: the script origins `src` loads, ignoring whole-line comments. */
export function scriptOrigins(src: string): string[] {
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    return SCRIPT_ORIGIN_PATTERNS.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]));
}

/** Pure: the source list of one CSP directive. */
export function directiveSources(policy: string, directive: string): string[] {
    const entry = policy.split(";").map((d) => d.trim().split(/\s+/)).find(([name]) => name === directive);
    return entry ? entry.slice(1) : [];
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return sourceFiles(full);
        return /\.(tsx?|jsx?|html)$/.test(e.name) ? [full] : [];
    });
}

describe("CSP script-src covers every script origin the app loads", () => {
    const allowed = directiveSources(CONTENT_SECURITY_POLICY, "script-src");
    const loaded = sourceFiles(join(process.cwd(), "src")).flatMap((file) =>
        scriptOrigins(readFileSync(file, "utf8")).map((origin) => ({ file, origin })),
    );

    it("no script origin under src/ is missing from script-src", () => {
        assert.deepEqual(loaded.filter(({ origin }) => !allowed.includes(origin)), []);
    });

    it("the scan sees the Turnstile loader (control: a scan that finds nothing proves nothing)", () => {
        assert.ok(loaded.some(({ origin }) => origin === "https://challenges.cloudflare.com"));
    });

    it("detects each loader shape and skips comment lines", () => {
        assert.deepEqual(scriptOrigins('<Script\n  src="https://js.stripe.com/v3"\n  strategy="lazyOnload" />'), ["https://js.stripe.com"]);
        assert.deepEqual(scriptOrigins('<script async src={"https://plausible.io/js/script.js"}></script>'), [
            "https://plausible.io",
            "https://plausible.io",
        ]);
        assert.deepEqual(scriptOrigins('el.src = "https://www.googletagmanager.com/gtag/js?id=G-1"'), ["https://www.googletagmanager.com"]);
        assert.deepEqual(scriptOrigins('await import("https://cdn.example.com/lib.mjs")'), ["https://cdn.example.com"]);
        assert.deepEqual(scriptOrigins(" * curl https://velai.app/ph/static/recorder.js"), []);
        assert.deepEqual(scriptOrigins('fetch("https://api.example.com/v1/jobs")'), []);
    });

    it("reads a directive's sources, and an origin absent from them is uncovered", () => {
        const policy = "default-src 'self'; script-src 'self' https://a.example; frame-src https://b.example";
        assert.deepEqual(directiveSources(policy, "script-src"), ["'self'", "https://a.example"]);
        assert.ok(!directiveSources(policy, "script-src").includes("https://b.example"));
    });
});

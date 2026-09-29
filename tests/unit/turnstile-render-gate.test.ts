import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gate: a Turnstile widget may render only through
 * components/ui/turnstile-widget.tsx, the one place that reports
 * `turnstile_error` and shows the fallback. A hand-rolled copy (own api.js
 * <Script>, `window.turnstile.render`, or a declarative `cf-turnstile` div)
 * would fail silently again when Cloudflare rejects the domain.
 *
 * No file allowlist: a line is exempt only if it carries the marker
 * `turnstile-wrapper: <reason>` on the same line.
 */
const RENDER_PATTERNS: RegExp[] = [/turnstile\/v0\/api\.js/, /turnstile\??\.render\s*\(/, /cf-turnstile/];
const EXEMPT_MARKER = /turnstile-wrapper:\s*\S+/;

/** Pure: 1-based line numbers in `src` that render a Turnstile widget without an on-line exemption. */
export function findUnwrappedTurnstileRenders(src: string): number[] {
    return src.split("\n").flatMap((line, i) => {
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
        return RENDER_PATTERNS.some((re) => re.test(code)) && !EXEMPT_MARKER.test(line) ? [i + 1] : [];
    });
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return sourceFiles(full);
        return /\.(tsx?|jsx?|html)$/.test(e.name) ? [full] : [];
    });
}

describe("turnstile render gate", () => {
    it("no file under src/ renders Turnstile outside the wrapper", () => {
        const offenders = sourceFiles(join(process.cwd(), "src")).flatMap((file) =>
            findUnwrappedTurnstileRenders(readFileSync(file, "utf8")).map((line) => `${file}:${line}`),
        );
        assert.deepEqual(offenders, []);
    });

    it("flags each of the three hand-rolled shapes, and honours the on-line marker", () => {
        assert.deepEqual(findUnwrappedTurnstileRenders('<Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" />'), [1]);
        assert.deepEqual(findUnwrappedTurnstileRenders("window.turnstile.render(el, {})"), [1]);
        assert.deepEqual(findUnwrappedTurnstileRenders("window.turnstile?.render(el, {})"), [1]);
        assert.deepEqual(findUnwrappedTurnstileRenders('<div className="cf-turnstile" data-sitekey="k" />'), [1]);
        assert.deepEqual(findUnwrappedTurnstileRenders("window.turnstile.render(el, {}) // turnstile-wrapper: the wrapper"), []);
        assert.deepEqual(findUnwrappedTurnstileRenders("window.turnstile.render(el, {}) // turnstile-wrapper:"), [1], "a marker needs a reason");
    });

    it("the wrapper's own render lines carry the marker (control: the scan sees them)", () => {
        const wrapper = readFileSync(join(process.cwd(), "src/components/ui/turnstile-widget.tsx"), "utf8");
        const hits = wrapper.split("\n").filter((l) => RENDER_PATTERNS.some((re) => re.test(l)));
        assert.ok(hits.length >= 2, "expected api.js + render lines in the wrapper");
        assert.ok(hits.every((l) => EXEMPT_MARKER.test(l)));
    });
});

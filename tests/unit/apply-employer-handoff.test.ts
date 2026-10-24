import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openApplyUrl } from "../../src/components/jobs/use-gated-apply";
import { isHttpApplyUrl } from "../../src/lib/jobs/http-url";

const APPLY_URLS = {
    workday: "https://manulife.wd3.myworkdayjobs.com/en-US/Manulife_Careers/job/Toronto/Role_R123",
    greenhouse: "https://boards.greenhouse.io/acme/jobs/123",
    ashby: "https://jobs.ashbyhq.com/acme/123",
    lever: "https://jobs.lever.co/acme/abc-def",
} as const;

describe("isHttpApplyUrl", () => {
    it("accepts common employer ATS hosts", () => {
        for (const url of Object.values(APPLY_URLS)) {
            assert.equal(isHttpApplyUrl(url), true);
        }
    });

    it("rejects empty and javascript URLs", () => {
        assert.equal(isHttpApplyUrl(""), false);
        assert.equal(isHttpApplyUrl("javascript:alert(1)"), false);
    });
});

describe("openApplyUrl", () => {
    it("opens the employer URL synchronously without a noopener feature string", () => {
        const calls: Array<{ url: string; target: string; features: string | undefined; openerNulled: boolean }> = [];

        const globalAny = globalThis as typeof globalThis & {
            window?: Window & typeof globalThis;
        };
        const priorWindow = globalAny.window;

        globalAny.window = {
            open(url?: string | URL, target?: string, features?: string) {
                const opened = { opener: {} as object | null };
                calls.push({
                    url: String(url),
                    target: target ?? "",
                    features,
                    openerNulled: false,
                });
                return new Proxy(opened, {
                    set(targetObj, prop, value) {
                        if (prop === "opener" && value === null) calls.at(-1)!.openerNulled = true;
                        return Reflect.set(targetObj, prop, value);
                    },
                }) as unknown as Window;
            },
        } as Window & typeof globalThis;

        try {
            for (const [label, url] of Object.entries(APPLY_URLS)) {
                openApplyUrl(url);
                const call = calls.at(-1);
                assert.ok(call, `expected window.open for ${label}`);
                assert.equal(call.url, url);
                assert.equal(call.target, "_blank");
                assert.equal(call.features, undefined);
                assert.equal(call.openerNulled, true);
                assert.notEqual(call.url, "about:blank");
            }

            const before = calls.length;
            openApplyUrl("");
            openApplyUrl("javascript:alert(1)");
            assert.equal(calls.length, before);
        } finally {
            globalAny.window = priorWindow;
        }
    });
});

describe("apply handoff source contracts", () => {
    const gatedApplySrc = readFileSync(
        join(__dirname, "../../src/components/jobs/use-gated-apply.ts"),
        "utf8",
    );
    const dialogSrc = readFileSync(
        join(__dirname, "../../src/components/jobs/ApplyIntentDialog.tsx"),
        "utf8",
    );

    it("use-gated-apply opens the URL directly and never uses about:blank or a noopener feature string", () => {
        const codeOnly = gatedApplySrc
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
        assert.match(codeOnly, /window\.open\(url, "_blank"\)/);
        assert.doesNotMatch(codeOnly, /noopener/);
        assert.doesNotMatch(codeOnly, /about:blank/);
    });

    it("ApplyIntentDialog continue control is an anchor with href navigation", () => {
        assert.match(dialogSrc, /href=\{postingHref\}/);
        assert.match(dialogSrc, /target="_blank"/);
        assert.match(dialogSrc, /rel="noopener noreferrer"/);
        assert.match(dialogSrc, /href=\{job\.apply_url\}|postingHref/);
        assert.doesNotMatch(dialogSrc, /openApplyUrl/);
        assert.doesNotMatch(
            dialogSrc.slice(dialogSrc.indexOf("handleContinueSideEffects")),
            /window\.open/,
        );
    });
});

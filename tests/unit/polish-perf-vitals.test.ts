import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const LAYOUT = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const JOBS_PAGE = readFileSync(path.join(ROOT, "src/app/jobs/page.tsx"), "utf8");
const JOBS_GATE = readFileSync(path.join(ROOT, "src/app/jobs/JobsRouteGate.tsx"), "utf8");
const JOBS_CONTENT = readFileSync(path.join(ROOT, "src/app/jobs/JobsContent.tsx"), "utf8");
const SPLASH = readFileSync(path.join(ROOT, "src/components/jobs/JobsListSplash.tsx"), "utf8");

test("body sans preloads with static cuts; display/mono defer preload", () => {
    assert.match(LAYOUT, /Source_Sans_3[\s\S]*preload:\s*true/);
    assert.match(LAYOUT, /Source_Sans_3[\s\S]*adjustFontFallback:\s*true/);
    assert.match(LAYOUT, /Source_Sans_3[\s\S]*display:\s*"optional"/);
    assert.match(LAYOUT, /Libre_Franklin[\s\S]*preload:\s*false/);
    assert.match(LAYOUT, /JetBrains_Mono[\s\S]*preload:\s*false/);
    assert.match(LAYOUT, /DeferredPostHogProvider/);
    assert.match(LAYOUT, /DeferredAuthKitProvider/);
    assert.match(LAYOUT, /IdleDeferredWidgets/);
    assert.doesNotMatch(LAYOUT, /import "\.\/elite-signal\.css"/);
    assert.match(JOBS_CONTENT, /import "@\/app\/elite-signal\.css"/);
    assert.doesNotMatch(LAYOUT, /JOBS_ONBOARDING_HEAD_SCRIPT/);
});

test("PostHog and AuthKit defer until load or idle", () => {
    const posthogDefer = readFileSync(
        path.join(ROOT, "src/components/providers/DeferredPostHogProvider.tsx"),
        "utf8",
    );
    const authDefer = readFileSync(
        path.join(ROOT, "src/components/providers/DeferredAuthKitProvider.tsx"),
        "utf8",
    );
    assert.match(posthogDefer, /scheduleAfterLoadOrIdle/);
    assert.match(authDefer, /scheduleAfterLoadOrIdle/);
    // Mounted beside the page, never around it: swapping the element above
    // children when the provider loaded remounted every page (J-NAV-41).
    for (const [src, provider] of [[posthogDefer, "PostHogProvider"], [authDefer, "AuthKitProvider"]] as const) {
        assert.match(src, new RegExp(`\\{children\\}\\s*\\{ready \\? <${provider}>\\{null\\}</${provider}> : null\\}`));
        assert.doesNotMatch(src, new RegExp(`<${provider}>\\{children\\}`));
        assert.doesNotMatch(src, /if \(!ready\)/);
    }
});

test("/jobs is board-first: no poster, chrome-hide classes or first-paint script", () => {
    assert.equal(existsSync(path.join(ROOT, "src/app/jobs/layout.tsx")), false);
    assert.equal(existsSync(path.join(ROOT, "src/app/jobs/loading.tsx")), false);
    assert.doesNotMatch(GLOBALS, /concept-a-landing-(pending|active)/);
    assert.doesNotMatch(GLOBALS, /#concept-a-ssr/);
    assert.doesNotMatch(JOBS_GATE, /ConceptALanding|localStorage|onboarding\.completed/);
});

test("signed-out /jobs entry is server page + thin route gate", () => {
    assert.doesNotMatch(JOBS_PAGE, /"use client"/);
    assert.match(JOBS_PAGE, /JobsRouteGate/);
    assert.match(JOBS_GATE, /import\("@\/app\/jobs\/JobsContent"\)/);
});

test("heavy jobs modules load via dynamic import in JobsContent", () => {
    assert.match(JOBS_CONTENT, /import\("@\/components\/jobs\/CategoryHubGrid"\)/);
    assert.match(JOBS_CONTENT, /import\("@\/components\/jobs\/JobDetail"\)/);
    assert.match(JOBS_CONTENT, /import\("@\/components\/resume-builder\/ResumeImportModal"\)/);
    assert.match(JOBS_CONTENT, /const JobDetail = dynamic\(/);
    assert.match(JOBS_CONTENT, /const ForYouHome = dynamic\(/);
});

test("in-page splash unchanged", () => {
    assert.match(JOBS_CONTENT, /JobsListSplash/);
    assert.match(SPLASH, /Finding live roles… checking each posting is still active/);
    assert.doesNotMatch(JOBS_CONTENT, /function JobsListSplash\(/);
});

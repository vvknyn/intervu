import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const LAYOUT = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const CONCEPT_A = readFileSync(
    path.join(ROOT, "src/components/onboarding/ConceptALanding.tsx"),
    "utf8",
);
const CONCEPT_A_FACE = readFileSync(
    path.join(ROOT, "src/components/onboarding/ConceptALandingFace.tsx"),
    "utf8",
);
const BRAND = readFileSync(path.join(ROOT, "src/components/brand/BrandMark.tsx"), "utf8");
const JOBS_PAGE = readFileSync(path.join(ROOT, "src/app/jobs/page.tsx"), "utf8");
const JOBS_GATE = readFileSync(path.join(ROOT, "src/app/jobs/JobsRouteGate.tsx"), "utf8");
const JOBS_CONTENT = readFileSync(path.join(ROOT, "src/app/jobs/JobsContent.tsx"), "utf8");
const LOADING = readFileSync(path.join(ROOT, "src/app/jobs/loading.tsx"), "utf8");
const SPLASH = readFileSync(path.join(ROOT, "src/components/jobs/JobsListSplash.tsx"), "utf8");
const JOBS_LAYOUT = readFileSync(path.join(ROOT, "src/app/jobs/layout.tsx"), "utf8");
const ONBOARDING_PAINT = readFileSync(path.join(ROOT, "src/lib/jobs/onboarding-first-paint.ts"), "utf8");

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
    assert.match(LAYOUT, /JOBS_ONBOARDING_HEAD_SCRIPT/);
});

test("Concept A hero h1 is visible on first paint (no enter-reveal on LCP)", () => {
    const critical = readFileSync(
        path.join(ROOT, "src/app/jobs/jobs-landing-critical.css.ts"),
        "utf8",
    );
    assert.match(critical, /#concept-a-ssr h1/);
    assert.doesNotMatch(CONCEPT_A_FACE, /enter-reveal/);
    assert.doesNotMatch(CONCEPT_A_FACE, /panel-enter/);
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
});

test("Concept A landing holds #main height while Step 1 body class is active", () => {
    assert.match(GLOBALS, /body\.concept-a-landing-active #main[\s\S]*min-height:\s*100dvh/);
    assert.match(GLOBALS, /html\.velai-onboarding-complete #concept-a-ssr/);
});

test("jobs layout SSR-paints Concept A before client /jobs bundle", () => {
    assert.match(JOBS_LAYOUT, /ConceptALandingStatic/);
    assert.match(JOBS_LAYOUT, /JOBS_LANDING_CRITICAL_CSS/);
    assert.match(ONBOARDING_PAINT, /concept-a-landing-active/);
    assert.match(ONBOARDING_PAINT, /velai-onboarding-complete/);
});

test("signed-out /jobs entry is server page + thin route gate", () => {
    assert.doesNotMatch(JOBS_PAGE, /"use client"/);
    assert.match(JOBS_PAGE, /JobsRouteGate/);
    assert.match(JOBS_GATE, /import\("@\/app\/jobs\/JobsContent"\)/);
    assert.match(JOBS_GATE, /ConceptALandingHydration/);
});

test("Concept A brand marks declare intrinsic sizes matching rendered slots", () => {
    assert.match(CONCEPT_A_FACE, /BrandMark className="h-8 w-8"[\s\S]*pixelSize=\{32\}[\s\S]*priority/);
    assert.match(CONCEPT_A_FACE, /BrandMark className="h-5 w-5 opacity-90"[\s\S]*pixelSize=\{20\}/);
    assert.match(CONCEPT_A, /ConceptALandingHydration/);
    assert.match(BRAND, /fetchPriority=\{priority \? "high" : undefined\}/);
});

test("jobs route loading stays inert during Concept A; in-page splash unchanged", () => {
    assert.match(LOADING, /jobs-route-loading-inert/);
    assert.match(JOBS_CONTENT, /JobsListSplash/);
    assert.match(SPLASH, /Finding live roles… checking each posting is still active/);
    assert.doesNotMatch(JOBS_CONTENT, /function JobsListSplash\(/);
});

test("heavy jobs modules load via dynamic import in JobsContent", () => {
    assert.match(JOBS_CONTENT, /import\("@\/components\/jobs\/CategoryHubGrid"\)/);
    assert.match(JOBS_CONTENT, /import\("@\/components\/jobs\/JobDetail"\)/);
    assert.match(JOBS_CONTENT, /import\("@\/components\/resume-builder\/ResumeImportModal"\)/);
    assert.match(JOBS_CONTENT, /const JobDetail = dynamic\(/);
    assert.match(JOBS_CONTENT, /const ForYouHome = dynamic\(/);
});

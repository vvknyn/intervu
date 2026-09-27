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
const LOADING = readFileSync(path.join(ROOT, "src/app/jobs/loading.tsx"), "utf8");
const SPLASH = readFileSync(path.join(ROOT, "src/components/jobs/JobsListSplash.tsx"), "utf8");
const JOBS_LAYOUT = readFileSync(path.join(ROOT, "src/app/jobs/layout.tsx"), "utf8");
const ONBOARDING_PAINT = readFileSync(path.join(ROOT, "src/lib/jobs/onboarding-first-paint.ts"), "utf8");

test("body sans preloads with static cuts; display/mono defer preload", () => {
    assert.match(LAYOUT, /Source_Sans_3[\s\S]*preload:\s*true/);
    assert.match(LAYOUT, /Source_Sans_3[\s\S]*adjustFontFallback:\s*true/);
    assert.match(LAYOUT, /Libre_Franklin[\s\S]*preload:\s*false/);
    assert.match(LAYOUT, /JetBrains_Mono[\s\S]*preload:\s*false/);
    assert.match(LAYOUT, /DeferredPostHogProvider/);
    assert.match(LAYOUT, /JOBS_ONBOARDING_HEAD_SCRIPT/);
});

test("Concept A landing holds #main height while Step 1 body class is active", () => {
    assert.match(GLOBALS, /body\.concept-a-landing-active #main[\s\S]*min-height:\s*100dvh/);
    assert.match(GLOBALS, /html\.velai-onboarding-complete #concept-a-ssr/);
});

test("jobs layout SSR-paints Concept A before client /jobs bundle", () => {
    assert.match(JOBS_LAYOUT, /ConceptALandingStatic/);
    assert.match(JOBS_LAYOUT, /JOBS_ONBOARDING_FIRST_PAINT_SCRIPT/);
    assert.match(ONBOARDING_PAINT, /concept-a-landing-active/);
    assert.match(ONBOARDING_PAINT, /velai-onboarding-complete/);
});

test("Concept A brand marks declare intrinsic sizes matching rendered slots", () => {
    assert.match(CONCEPT_A_FACE, /BrandMark className="h-8 w-8"[\s\S]*pixelSize=\{32\}[\s\S]*priority/);
    assert.match(CONCEPT_A_FACE, /BrandMark className="h-5 w-5 opacity-90"[\s\S]*pixelSize=\{20\}/);
    assert.match(CONCEPT_A, /ConceptALandingHydration/);
    assert.match(BRAND, /fetchPriority=\{priority \? "high" : undefined\}/);
});

test("jobs route loading and in-page splash share one skeleton component", () => {
    assert.match(LOADING, /JobsListSplash/);
    assert.match(JOBS_PAGE, /JobsListSplash/);
    assert.match(SPLASH, /Finding live roles… checking each posting is still active/);
    assert.doesNotMatch(JOBS_PAGE, /function JobsListSplash\(/);
});

test("heavy jobs modules load via dynamic import on the client page", () => {
    assert.match(JOBS_PAGE, /import\("@\/components\/jobs\/CategoryHubGrid"\)/);
    assert.match(JOBS_PAGE, /import\("@\/components\/jobs\/JobDetail"\)/);
    assert.match(JOBS_PAGE, /import\("@\/components\/resume-builder\/ResumeImportModal"\)/);
    assert.match(JOBS_PAGE, /const JobDetail = dynamic\(/);
});

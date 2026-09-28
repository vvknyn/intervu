import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    JOBS_ONBOARDING_HEAD_SCRIPT,
    isSharedJobPath,
} from "../../src/lib/jobs/onboarding-first-paint";

function runScript(pathname: string, storage: Record<string, string> = {}, cookie = "") {
    const html = new Set<string>();
    const body = new Set<string>();
    const classList = (set: Set<string>) => ({
        add: (...names: string[]) => names.forEach((name) => set.add(name)),
        remove: (...names: string[]) => names.forEach((name) => set.delete(name)),
    });
    const context = {
        location: { pathname },
        localStorage: { getItem: (key: string) => storage[key] ?? null },
        document: {
            cookie,
            documentElement: { classList: classList(html) },
            body: { classList: classList(body) },
            addEventListener() {},
        },
    };
    vm.runInNewContext(JOBS_ONBOARDING_HEAD_SCRIPT, context);
    return { html, body };
}

test("shared job paths are /jobs/<slug>, not the hub", () => {
    assert.equal(isSharedJobPath("/jobs/nurse-at-acme-11111111-1111-4111-8111-111111111111"), true);
    assert.equal(isSharedJobPath("/jobs"), false);
    assert.equal(isSharedJobPath("/jobs/"), false);
    assert.equal(isSharedJobPath("/resume"), false);
    assert.equal(isSharedJobPath("/careers/remote-jobs"), false);
});

test("head script keeps the site header on a shared job", () => {
    const fresh = runScript("/jobs/nurse-at-acme-11111111-1111-4111-8111-111111111111");
    assert.equal(fresh.html.has("velai-jobs-skip-landing"), true);
    assert.equal(fresh.html.has("concept-a-landing-pending"), false);
    assert.equal(fresh.body.has("velai-jobs-skip-landing"), true);
    assert.equal(fresh.body.has("concept-a-landing-active"), false);
});

test("head script still hides hub chrome on exact /jobs until onboarding is done", () => {
    const fresh = runScript("/jobs");
    assert.equal(fresh.html.has("concept-a-landing-pending"), true);
    assert.equal(fresh.body.has("concept-a-landing-active"), true);
    assert.equal(fresh.html.has("velai-jobs-skip-landing"), false);

    const done = runScript("/jobs", { "velai.onboarding.completed": "1" });
    assert.equal(done.html.has("velai-onboarding-complete"), true);
    assert.equal(done.html.has("concept-a-landing-pending"), false);
    assert.equal(done.body.has("concept-a-landing-active"), false);
});

test("head script skips the Step 1 poster when the signed-in paint hint is set", () => {
    const hinted = runScript("/jobs", {}, "velai_jobs_signed_in=1");
    assert.equal(hinted.html.has("velai-jobs-skip-landing"), true);
    assert.equal(hinted.html.has("concept-a-landing-pending"), false);
    assert.equal(hinted.body.has("velai-jobs-skip-landing"), true);
    assert.equal(hinted.body.has("concept-a-landing-active"), false);

    const lookalike = runScript("/jobs", {}, "other=velai_jobs_signed_in=1");
    assert.equal(lookalike.html.has("concept-a-landing-pending"), true);
    assert.equal(lookalike.html.has("velai-jobs-skip-landing"), false);
});

test("head script does not touch résumé, careers, or apply routes", () => {
    for (const pathname of ["/resume", "/careers/remote-jobs", "/yours", "/settings"]) {
        const result = runScript(pathname);
        assert.equal(result.html.size, 0, pathname);
        assert.equal(result.body.size, 0, pathname);
    }
});

test("jobs layout mounts the shared-job header guard beside the hub poster", () => {
    const layout = readFileSync(path.join(__dirname, "../../src/app/jobs/layout.tsx"), "utf8");
    assert.match(layout, /SharedJobHeaderGuard/);
    assert.match(layout, /ConceptALandingStatic/);
    const guard = readFileSync(
        path.join(__dirname, "../../src/components/layout/SharedJobHeaderGuard.tsx"),
        "utf8",
    );
    assert.match(guard, /revealSharedJobHeader/);
    assert.match(guard, /isSharedJobPath/);
});

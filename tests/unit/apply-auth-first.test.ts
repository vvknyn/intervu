import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");
// `mock` is dev-only fixture UI (hardcoded example.com URLs, never a real
// employer posting) — excluded as a class, not file by file, since nothing
// under it can reach a real ATS regardless of what it calls. Two roots carry
// it: the app-router pages (`src/app/mock`) and the decorative mockup
// components they render (`src/components/mock` — e.g. CompletenessMock.tsx,
// itself marked `design-lint-allow-file: decorative mockup, not product
// chrome`), never a third, unrelated directory that happens to have "mock"
// in its name.
const MOCK_DIRS = [join(SRC, "app", "mock"), join(SRC, "components", "mock")].map((d) => d + sep);

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(tsx|ts)$/.test(name)) out.push(path);
    }
    return out;
}

const ALL_SRC_FILES = walk(SRC).filter((file) => !MOCK_DIRS.some((dir) => file.startsWith(dir)));

/**
 * apply-behind-signup (2026-09-18): a signed-out visitor must never reach the
 * employer's ATS from ANY job surface — the SERP, a job's own detail panel,
 * or the saved-job tracker — before signing up/in. `resolveApplyClickDecision`
 * (src/lib/jobs/pending-actions.ts), wrapped by the shared `useGatedApply`
 * hook (src/components/jobs/use-gated-apply.ts), is the one chokepoint that
 * decides this — guests get "auth-first", never the old "open-then-auth"
 * (open the ATS, THEN gate) contract. These are class-wide source scans over
 * ALL of `src`, not a check on the handful of call sites that motivated the
 * change: (a) proves the retired contract's spelling is gone everywhere it
 * could have leaked, (b) proves every navigation site anywhere in the app
 * that could plausibly open an employer posting is one that actually
 * consults the decision, so a new mount added later — on /jobs, on /yours,
 * or on a surface that doesn't exist yet — can't quietly bypass the gate.
 */
describe("apply-behind-signup — class-wide guarantees", () => {
    it('no file that imports resolveApplyClickDecision still contains the retired "open-then-auth" string', () => {
        const importers = ALL_SRC_FILES.filter((file) =>
            readFileSync(file, "utf8").includes("resolveApplyClickDecision"),
        );
        assert.ok(importers.length >= 1, "expected at least one consumer to reference resolveApplyClickDecision");

        const offenders = importers.filter((file) => readFileSync(file, "utf8").includes("open-then-auth"));
        assert.deepEqual(
            offenders,
            [],
            `retired "open-then-auth" decision value still referenced in: ${offenders.join(", ")}`,
        );
    });

    it("every apply_url/job_url navigation site anywhere in src is routed through the shared apply gate", () => {
        // Two independent conditions, deliberately not fused into one regex
        // (the previous version's `window\.open\([^)]*apply_url` missed a
        // navigation call sitting a few lines below the URL it closed over —
        // exactly the shape `/yours`'s three offending buttons had): a file
        // is in scope if it mentions either URL field ANYWHERE, and
        // separately contains ANY of the three ways this codebase navigates
        // a tab/window. In scope + no gate import = offender.
        const REFERENCES_APPLY_LINK = /(apply_url|job_url)/;
        const NAVIGATES = /(window\.open\(|location\.href\s*=|location\.assign\()/;
        const IMPORTS_THE_GATE = /(useGatedApply|resolveApplyClickDecision)/;

        const offenders: string[] = [];
        for (const file of ALL_SRC_FILES) {
            const src = readFileSync(file, "utf8");
            if (!REFERENCES_APPLY_LINK.test(src) || !NAVIGATES.test(src)) continue;
            if (IMPORTS_THE_GATE.test(src)) continue;
            offenders.push(file);
        }
        assert.deepEqual(
            offenders,
            [],
            `apply_url/job_url navigation without the shared apply gate in: ${offenders.join(", ")}`,
        );
    });
});

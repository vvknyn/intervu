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

    it("every raw navigation call in a file that handles employer URLs is routed through the shared apply gate", () => {
        // File-level "does this file import the gate somewhere" (the
        // previous version of this test) missed a regression where ONE of
        // several navigation call sites in an already-gate-importing file
        // reverted to a raw `window.open` while its siblings stayed gated —
        // the file-level import check can't see which specific call site
        // it's guarding. The class property is "a raw navigation call in a
        // file that handles employer URLs" — so every occurrence, not every
        // file, must clear one of two exemptions: (a) it lives in
        // use-gated-apply.ts, the single sanctioned site every `perform`
        // callback now calls through (`openApplyUrl`) instead of duplicating
        // `window.open` per caller, or (b) it carries an inline
        // `// not-an-apply-link: <reason>` marker (same line or the line
        // above) for a genuine non-apply navigation — share, docs, company
        // site — that happens to sit in a file that also mentions an apply
        // link. No production call site needs (b) today; it exists so a
        // future non-apply navigation in one of these files has a sanctioned
        // path instead of tempting someone to widen the gate check.
        const REFERENCES_APPLY_LINK = /(apply_url|job_url)/;
        const NAVIGATES = /(window\.open\(|location\.href\s*=|location\.assign\()/;
        const EXEMPT_MARKER = /\/\/\s*not-an-apply-link:/;
        const SANCTIONED_FILE = join(SRC, "components", "jobs", "use-gated-apply.ts");

        const offenders: string[] = [];
        for (const file of ALL_SRC_FILES) {
            if (file === SANCTIONED_FILE) continue;
            const src = readFileSync(file, "utf8");
            if (!REFERENCES_APPLY_LINK.test(src)) continue;
            const lines = src.split("\n");
            lines.forEach((line, i) => {
                if (!NAVIGATES.test(line)) return;
                if (EXEMPT_MARKER.test(line) || (i > 0 && EXEMPT_MARKER.test(lines[i - 1]))) return;
                offenders.push(`${file}:${i + 1}`);
            });
        }
        assert.deepEqual(
            offenders,
            [],
            `raw navigation call not routed through the shared apply gate: ${offenders.join(", ")}`,
        );
    });
});

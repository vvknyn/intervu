import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");
const JOBS_APP = join(SRC, "app/jobs");
const JOBS_COMPONENTS = join(SRC, "components/jobs");

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(tsx|ts)$/.test(name)) out.push(path);
    }
    return out;
}

const ALL_SRC_FILES = walk(SRC);
const JOBS_SURFACE_FILES = [...walk(JOBS_APP), ...walk(JOBS_COMPONENTS)];

/**
 * apply-behind-signup (2026-09-18): a signed-out visitor must never reach the
 * employer's ATS from any /jobs surface before signing up/in.
 * `resolveApplyClickDecision` (src/lib/jobs/pending-actions.ts) is the one
 * chokepoint that decides this — guests now get "auth-first", not the old
 * "open-then-auth" (open the ATS, THEN gate) contract. These are class-wide
 * source scans, not a check on the one call site that motivated the change:
 * (a) proves the retired contract's spelling is gone everywhere it could
 * have leaked, (b) proves every apply_url navigation site in the /jobs
 * surface area is one that actually consults the decision, so a new mount
 * added later can't quietly bypass the gate.
 */
describe("apply-behind-signup — class-wide guarantees", () => {
    it('no file that imports resolveApplyClickDecision still contains the retired "open-then-auth" string', () => {
        const importers = ALL_SRC_FILES.filter((file) =>
            readFileSync(file, "utf8").includes("resolveApplyClickDecision"),
        );
        assert.ok(importers.length >= 2, "expected at least the two known consumers to reference resolveApplyClickDecision");

        const offenders = importers.filter((file) => readFileSync(file, "utf8").includes("open-then-auth"));
        assert.deepEqual(
            offenders,
            [],
            `retired "open-then-auth" decision value still referenced in: ${offenders.join(", ")}`,
        );
    });

    it("every apply_url navigation site (window.open or href) is routed through resolveApplyClickDecision", () => {
        // Matches an ACTUAL navigation call passing apply_url — not every
        // mention of apply_url (e.g. `job.apply_url &&` gating whether a
        // button renders at all is fine and common; it doesn't navigate).
        const NAVIGATES_TO_APPLY_URL = /(window\.open\([^)]*apply_url|href=\{[^}]*apply_url)/;

        const offenders: string[] = [];
        for (const file of JOBS_SURFACE_FILES) {
            const src = readFileSync(file, "utf8");
            if (!NAVIGATES_TO_APPLY_URL.test(src)) continue;
            if (src.includes("resolveApplyClickDecision")) continue;
            offenders.push(file);
        }
        assert.deepEqual(
            offenders,
            [],
            `apply_url navigation without the auth gate's decision in: ${offenders.join(", ")}`,
        );
    });
});

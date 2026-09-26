import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { resolveApplyClickDecision } from "../../src/lib/jobs/pending-actions";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");
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

describe("apply-open-first — class-wide guarantees", () => {
    it("signed-out Apply is perform, not auth-first", () => {
        assert.equal(resolveApplyClickDecision(false), "perform");
        assert.equal(resolveApplyClickDecision(true), "perform");
    });

    it("no file that imports resolveApplyClickDecision still contains auth-first gating", () => {
        const importers = ALL_SRC_FILES.filter((file) =>
            readFileSync(file, "utf8").includes("resolveApplyClickDecision"),
        );
        assert.ok(importers.length >= 1);
        const offenders = importers.filter((file) => readFileSync(file, "utf8").includes("auth-first"));
        assert.deepEqual(offenders, [], `auth-first still referenced in: ${offenders.join(", ")}`);
    });

    it("every raw navigation call in a file that handles employer URLs is routed through the shared apply gate", () => {
        const REFERENCES_APPLY_LINK = /(apply_url|job_url)/;
        const RAW_APPLY_NAV =
            /(window\.open\([^)]*(apply_url|job\.apply_url)|location\.(href\s*=|assign)\([^)]*(apply_url|job\.apply_url))/;
        const EXEMPT_MARKER = /\/\/\s*not-an-apply-link:/;
        const SANCTIONED_FILE = join(SRC, "components", "jobs", "use-gated-apply.ts");
        const ANCHOR_HANDOFF_FILE = join(SRC, "components", "jobs", "ApplyIntentDialog.tsx");

        const offenders: string[] = [];
        for (const file of ALL_SRC_FILES) {
            if (file === SANCTIONED_FILE || file === ANCHOR_HANDOFF_FILE) continue;
            const src = readFileSync(file, "utf8");
            if (!REFERENCES_APPLY_LINK.test(src)) continue;
            const lines = src.split("\n");
            lines.forEach((line, i) => {
                if (!RAW_APPLY_NAV.test(line)) return;
                if (EXEMPT_MARKER.test(line) || (i > 0 && EXEMPT_MARKER.test(lines[i - 1]))) return;
                offenders.push(`${file}:${i + 1}`);
            });
        }
        assert.deepEqual(
            offenders,
            [],
            `raw apply-url navigation not routed through the shared apply gate: ${offenders.join(", ")}`,
        );
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Per-surface off-token ratchet — docs/design-language.md §8.
 *
 * scripts/design/off-token-counts.cjs scans each design-language surface
 * (jobs, for-you, yours, resume, tracker, settings, company, auth, layout,
 * ui, trends, marketing) for the off-token class families the spec retires
 * (rounded-none, size-named radii, arbitrary text/leading/size/padding
 * values, hex literals, shadow-* utilities, inline style={{...}}) and
 * counts them per surface. tests/unit/design-token-baseline.json pins that
 * count. A surface/pattern count may only go DOWN over time: a PR that
 * raises one fails this test by name (surface + pattern + before/after
 * numbers); a PR that lowers one still passes, but prints a "tighten the
 * baseline" nudge so the baseline doesn't silently drift stale (mirrors the
 * ALLOWED-list contract in module-adoption.test.ts).
 *
 * Regenerate the baseline after a real reduction:
 *   node scripts/design/off-token-counts.cjs --write
 */
const { diffOffTokenCounts, scanOffTokenCounts, SURFACE_ROOTS, PATTERNS, BASELINE_PATH } = require("../../scripts/design/off-token-counts.cjs") as {
    diffOffTokenCounts: (
        current: Record<string, Record<string, number>>,
        baseline: Record<string, Record<string, number>>,
    ) => {
        increased: Array<{ surface: string; pattern: string; baseline: number; current: number }>;
        decreased: Array<{ surface: string; pattern: string; baseline: number; current: number }>;
    };
    scanOffTokenCounts: () => Record<string, Record<string, number>>;
    SURFACE_ROOTS: Record<string, string[]>;
    PATTERNS: Array<{ name: string; re: RegExp }>;
    BASELINE_PATH: string;
};

// ---------------------------------------------------------------------------
// Pure diff: proven on synthetic counts, not the real repo — same shape as
// module-adoption.test.ts's describeAdoptionDrift fixtures.
// ---------------------------------------------------------------------------

describe("diffOffTokenCounts — fixtures", () => {
    it("a surface/pattern count that grew over baseline is reported as an increase (fails the ratchet)", () => {
        const current = { jobs: { "rounded-none": 3 } };
        const baseline = { jobs: { "rounded-none": 1 } };
        const { increased, decreased } = diffOffTokenCounts(current, baseline);
        assert.deepEqual(increased, [{ surface: "jobs", pattern: "rounded-none", baseline: 1, current: 3 }]);
        assert.deepEqual(decreased, []);
    });

    it("a surface/pattern count that shrank below baseline is reported as a decrease and never fails", () => {
        const current = { settings: { "text-arbitrary": 0 } };
        const baseline = { settings: { "text-arbitrary": 4 } };
        const { increased, decreased } = diffOffTokenCounts(current, baseline);
        assert.deepEqual(increased, []);
        assert.deepEqual(decreased, [{ surface: "settings", pattern: "text-arbitrary", baseline: 4, current: 0 }]);
    });

    it("an unchanged count produces no drift in either direction", () => {
        const current = { ui: { "hex-literal": 0 } };
        const baseline = { ui: { "hex-literal": 0 } };
        const { increased, decreased } = diffOffTokenCounts(current, baseline);
        assert.deepEqual(increased, []);
        assert.deepEqual(decreased, []);
    });

    it("a pattern absent from current but present in baseline counts as zero, i.e. a decrease", () => {
        const current = { tracker: {} };
        const baseline = { tracker: { "shadow-utility": 2 } };
        const { increased, decreased } = diffOffTokenCounts(current, baseline);
        assert.deepEqual(increased, []);
        assert.deepEqual(decreased, [{ surface: "tracker", pattern: "shadow-utility", baseline: 2, current: 0 }]);
    });

    it("multiple regressions across surfaces are all named, sorted by surface then pattern", () => {
        const current = {
            yours: { "rounded-none": 5, "size-arbitrary": 2 },
            auth: { "padding-arbitrary": 1 },
        };
        const baseline = {
            yours: { "rounded-none": 5, "size-arbitrary": 0 },
            auth: { "padding-arbitrary": 0 },
        };
        const { increased } = diffOffTokenCounts(current, baseline);
        assert.deepEqual(increased, [
            { surface: "auth", pattern: "padding-arbitrary", baseline: 0, current: 1 },
            { surface: "yours", pattern: "size-arbitrary", baseline: 0, current: 2 },
        ]);
    });
});

// ---------------------------------------------------------------------------
// The actual guard: scan the real repo, compare to the committed baseline.
// ---------------------------------------------------------------------------

describe("per-surface off-token ratchet", () => {
    it("every declared surface has at least one real directory backing it", () => {
        for (const roots of Object.values(SURFACE_ROOTS)) {
            assert.ok(roots.length > 0);
        }
    });

    it("no surface/pattern off-token count exceeds its committed baseline", () => {
        const current = scanOffTokenCounts();
        const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
        const { increased, decreased } = diffOffTokenCounts(current, baseline);

        if (decreased.length) {
            console.log(
                `design-token-ratchet: ${decreased.length} surface/pattern count(s) improved — tighten ` +
                    `tests/unit/design-token-baseline.json (run \`node scripts/design/off-token-counts.cjs --write\`): ` +
                    decreased.map((d) => `${d.surface}/${d.pattern} ${d.baseline}->${d.current}`).join(", "),
            );
        }

        assert.deepEqual(
            increased,
            [],
            `${increased.length} surface/pattern off-token count(s) regressed over baseline: ` +
                increased.map((d) => `${d.surface}/${d.pattern} ${d.baseline}->${d.current}`).join(", ") +
                `. Either remove the off-token class(es) or, if the increase is deliberate, lower the bar ` +
                `deliberately by regenerating the baseline in this same PR.`,
        );
    });

    it("PATTERNS covers every off-token family named in docs/design-language.md §8", () => {
        const names = PATTERNS.map((p) => p.name);
        assert.deepEqual(
            names,
            [
                "rounded-none",
                "rounded-size",
                "rounded-arbitrary",
                "text-arbitrary",
                "leading-arbitrary",
                "size-arbitrary",
                "padding-arbitrary",
                "hex-literal",
                "shadow-utility",
                "inline-style",
            ],
        );
    });
});

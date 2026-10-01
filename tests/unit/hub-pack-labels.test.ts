import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_CATEGORY_HUBS,
} from "../../src/components/jobs/CategoryHubGrid";
import {
    BROWSE_HUB_PACK_IDS,
    HUB_PACK_IDS,
    HUB_PACK_SHORT_LABELS,
} from "../../src/lib/jobs/for-you/hub-pack-filters";
import { industryTileCandidates } from "../../src/lib/jobs/for-you/industry-tiles";
import { INDUSTRY_IDS } from "../../src/lib/jobs/resume-industry";

describe("hub pack category labels", () => {
    it("CategoryHubGrid labels match HUB_PACK_SHORT_LABELS (single source of display copy)", () => {
        const byId = Object.fromEntries(DEFAULT_CATEGORY_HUBS.map((h) => [h.id, h.label]));
        for (const packId of BROWSE_HUB_PACK_IDS) {
            assert.equal(
                byId[packId],
                HUB_PACK_SHORT_LABELS[packId],
                `label drift for pack "${packId}"`,
            );
        }
    });

    it("every industry tile has a short label in sentence case", () => {
        for (const industry of INDUSTRY_IDS) {
            for (const id of industryTileCandidates(industry)) {
                const label = HUB_PACK_SHORT_LABELS[id];
                assert.ok(label, `${industry} tile "${id}" has no label`);
                assert.ok(HUB_PACK_IDS.includes(id), `${industry} tile "${id}" is not a hub pack id`);
                assert.ok(label.length <= 30, `"${label}" is too long for a chip`);
                // Sentence case: only the first word capitalised, bar acronyms and K–12.
                for (const word of label.split(/\s+/).slice(1)) {
                    assert.ok(!/^[A-Z][a-z]/.test(word), `"${label}" capitalises "${word}"`);
                }
            }
        }
    });

    it("AI and lead packs use sentence case on hub tiles", () => {
        const hub = readFileSync(
            join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx"),
            "utf8",
        );
        assert.match(hub, /label: "Artificial intelligence"/);
        assert.match(hub, /label: "Lead & principal"/);
    });

    it("hub pack titles show in full, without truncate, ellipsis, or line clamp", () => {
        const hub = readFileSync(
            join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx"),
            "utf8",
        );
        const titleBlock =
            hub.match(/data-testid=\{`hub-pack-title-\$\{category\.id\}`\}[\s\S]*?\{category\.label\}/)?.[0] ?? "";
        assert.ok(titleBlock.length > 0, "hub pack title must expose hub-pack-title test id");
        assert.doesNotMatch(titleBlock, /\btruncate\b/);
        assert.doesNotMatch(titleBlock, /line-clamp-\d/);
        assert.doesNotMatch(titleBlock, /text-ellipsis/);
        // Each pack is one chip on one line; the chip row wraps instead, so a long label never cuts.
        assert.match(hub, /data-testid="hub-pack-chips" className="flex flex-wrap/);
    });

    it("long pack labels stay in catalog for layout regression", () => {
        const byId = Object.fromEntries(DEFAULT_CATEGORY_HUBS.map((h) => [h.id, h.label]));
        assert.equal(byId.ai, "Artificial intelligence");
        assert.equal(byId.apply, "1-Click tailored apply");
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_CATEGORY_HUBS,
} from "../../src/components/jobs/CategoryHubGrid";
import {
    HUB_PACK_IDS,
    HUB_PACK_SHORT_LABELS,
} from "../../src/lib/jobs/for-you/hub-pack-filters";

describe("hub pack category labels", () => {
    it("CategoryHubGrid labels match HUB_PACK_SHORT_LABELS (single source of display copy)", () => {
        const byId = Object.fromEntries(DEFAULT_CATEGORY_HUBS.map((h) => [h.id, h.label]));
        for (const packId of HUB_PACK_IDS) {
            assert.equal(
                byId[packId],
                HUB_PACK_SHORT_LABELS[packId],
                `label drift for pack "${packId}"`,
            );
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

    it("hub pack titles wrap fully without truncate, ellipsis, or line clamp", () => {
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
        assert.match(titleBlock, /whitespace-normal/);
        assert.match(titleBlock, /break-words/);
    });

    it("long pack labels stay in catalog for layout regression", () => {
        const byId = Object.fromEntries(DEFAULT_CATEGORY_HUBS.map((h) => [h.id, h.label]));
        assert.equal(byId.ai, "Artificial intelligence");
        assert.equal(byId.apply, "1-Click tailored apply");
    });
});

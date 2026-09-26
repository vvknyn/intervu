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
});

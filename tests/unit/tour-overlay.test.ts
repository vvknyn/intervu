import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TOUR_DIR = join(__dirname, "..", "..", "src", "components", "tour");
const OVERLAY = join(TOUR_DIR, "TourOverlayCard.tsx");
const GATE = join(TOUR_DIR, "TourOverlay.tsx");

describe("TourOverlay single-step chrome", () => {
    it("hides Previous when the tour is only one step", () => {
        const src = readFileSync(OVERLAY, "utf8");
        assert.match(src, /steps\.length === 1/);
        assert.match(src, /Previous/);
        assert.match(src, /isSingleStep/);
        assert.match(src, /stopTour/);
    });
});

describe("TourOverlay loads the animation code only while a tour is showing", () => {
    it("the always-mounted gate does not import framer-motion, directly or statically", () => {
        const gate = readFileSync(GATE, "utf8");
        assert.doesNotMatch(gate, /from\s+["']framer-motion["']/);
        assert.doesNotMatch(gate, /from\s+["']@\/components\/tour\/TourOverlayCard["']/);
        assert.match(gate, /import\(\s*["']@\/components\/tour\/TourOverlayCard["']\s*\)/);
    });

    it("the gate mounts the card under the same conditions the card draws under", () => {
        const gate = readFileSync(GATE, "utf8");
        const card = readFileSync(OVERLAY, "utf8");
        for (const condition of ["!isActive", "isMinimized", "steps.length === 0", "!targetRect"]) {
            assert.ok(gate.includes(condition), `gate: ${condition}`);
            assert.ok(card.includes(condition), `card: ${condition}`);
        }
    });

    it("only the card imports framer-motion (the one module a page may not load early)", () => {
        const offenders = readdirSync(TOUR_DIR)
            .filter((f) => /\.tsx?$/.test(f) && f !== "TourOverlayCard.tsx")
            .filter((f) => /from\s+["']framer-motion["']/.test(readFileSync(join(TOUR_DIR, f), "utf8")));
        assert.deepEqual(offenders, []);
    });
});

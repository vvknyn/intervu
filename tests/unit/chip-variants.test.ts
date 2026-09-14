import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chipVariants } from "../../src/components/ui/chip";

/**
 * Chips visually respond to hover with `hover:bg-muted` unconditionally,
 * even when the chip is plain informational text (PreferenceChipStrip's
 * "Your preferences" chips: a <span> with no onClick anywhere in it) — a
 * false affordance. Fixed at the seam (chip.tsx): the hover/cursor classes
 * moved out of the base string and into an `interactive` variant that
 * defaults to false, so every existing inert call site is safe by
 * construction, not by each one remembering to opt out.
 */
describe("chipVariants: hover affordance is opt-in, safe by default", () => {
    it("PreferenceChipStrip's exact inert call (active: false, no interactive) carries no hover affordance", () => {
        const classes = chipVariants({ active: false });
        assert.ok(!classes.includes("hover:bg-muted"), classes);
        assert.ok(!classes.includes("cursor-pointer"), classes);
    });

    it("a second, different inert usage — ForYouPack's DERIVED_CHIP_CLASS (active: true, no interactive) — still carries no hover affordance", () => {
        // Proves the default isn't accidentally keyed off `active`: an
        // active-but-inert chip (an inferred-match chip, not a control)
        // must stay just as inert as an active:false one.
        const classes = chipVariants({ active: true });
        assert.ok(!classes.includes("hover:bg-muted"), classes);
        assert.ok(!classes.includes("cursor-pointer"), classes);
    });

    it("calling with no arguments at all falls back to the same safe default", () => {
        const classes = chipVariants();
        assert.ok(!classes.includes("hover:bg-muted"), classes);
        assert.ok(!classes.includes("cursor-pointer"), classes);
    });

    it("a real control opts in with interactive: true and gets the hover affordance", () => {
        const classes = chipVariants({ active: false, interactive: true });
        assert.ok(classes.includes("hover:bg-muted"), classes);
        assert.ok(classes.includes("cursor-pointer"), classes);
    });
});

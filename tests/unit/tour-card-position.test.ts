import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CARD_PADDING,
  CARD_WIDTH,
  SPOTLIGHT_PADDING,
  computeCardPosition,
  effectiveCardWidth,
} from "../../src/components/tour/tour-card-position";

const OVERLAY = path.join(process.cwd(), "src/components/tour/TourOverlay.tsx");

test("tour card position", async (t) => {
  await t.test("mobile tab target: card sits above the bottom tab", () => {
    const viewport = { width: 390, height: 844 };
    const target = { top: 788, left: 234, width: 78, height: 56, bottom: 844, right: 312 };
    const cardHeight = 240;
    const cardWidth = effectiveCardWidth(viewport.width);

    const pos = computeCardPosition(viewport, target, "top", cardHeight, cardWidth);

    assert.ok(pos.top >= CARD_PADDING, "card top must stay inside viewport padding");
    assert.ok(
      pos.top + cardHeight <= target.top - SPOTLIGHT_PADDING,
      "card must sit above the tab target",
    );
    assert.ok(pos.left >= CARD_PADDING, "card left must stay inside viewport padding");
    assert.ok(
      pos.left + cardWidth <= viewport.width - CARD_PADDING,
      "card right edge must stay inside viewport padding",
    );
    assert.equal(pos.arrowSide, "bottom");
  });

  await t.test("desktop header target: flips below when no room above", () => {
    const viewport = { width: 1280, height: 800 };
    const target = { top: 12, left: 900, width: 80, height: 40, bottom: 52, right: 980 };
    const cardHeight = 240;
    const cardWidth = effectiveCardWidth(viewport.width);

    const pos = computeCardPosition(viewport, target, "top", cardHeight, cardWidth);

    assert.ok(pos.top >= target.bottom + SPOTLIGHT_PADDING, "card flips below the header link");
    assert.ok(pos.top + cardHeight <= viewport.height - CARD_PADDING, "card bottom stays in viewport");
    assert.ok(pos.left >= CARD_PADDING, "card left stays in viewport");
    assert.ok(pos.left + cardWidth <= viewport.width - CARD_PADDING, "card right stays in viewport");
    assert.equal(pos.arrowSide, "top");
  });

  await t.test("narrow viewport: card width shrinks to fit padding", () => {
    const viewport = { width: 320, height: 568 };
    const target = { top: 500, left: 120, width: 80, height: 40, bottom: 540, right: 200 };
    const cardHeight = 200;
    const cardWidth = effectiveCardWidth(viewport.width);

    assert.equal(cardWidth, CARD_WIDTH - 2 * CARD_PADDING, "320px viewport caps card width at 296px");

    const pos = computeCardPosition(viewport, target, "top", cardHeight, cardWidth);

    assert.ok(pos.left >= CARD_PADDING);
    assert.ok(pos.left + cardWidth <= viewport.width - CARD_PADDING);
  });

  await t.test("TourOverlay wrapper does not clip with overflow-hidden", () => {
    const src = readFileSync(OVERLAY, "utf8");
    const wrapperMatch = src.match(
      /className="fixed inset-0 z-\[200\][^"]*"/,
    );
    assert.ok(wrapperMatch, "overlay wrapper className must exist");
    assert.doesNotMatch(wrapperMatch![0], /overflow-hidden/);
  });
});

export const CARD_WIDTH = 320;
export const CARD_PADDING = 12;
export const SPOTLIGHT_PADDING = 8;
export const ARROW_SIZE = 8;

/** Gap between target edge and card (spotlight pad + arrow + small offset). */
const FLIP_GAP = SPOTLIGHT_PADDING + ARROW_SIZE + 4;

export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CardPosition {
  top: number;
  left: number;
  arrowSide: "top" | "bottom" | "left" | "right";
  arrowOffset: number;
}

export type CardPlacement = "top" | "bottom" | "left" | "right";

export function effectiveCardWidth(viewportWidth: number): number {
  return Math.min(CARD_WIDTH, viewportWidth - 2 * CARD_PADDING);
}

export function maxCardHeight(viewportHeight: number): number {
  return viewportHeight - 2 * CARD_PADDING;
}

export function computeCardPosition(
  viewport: ViewportSize,
  target: RectLike,
  placement: CardPlacement,
  cardHeight: number,
  cardWidth: number,
): CardPosition {
  const { width: vw, height: vh } = viewport;

  let top = 0;
  let left = 0;
  let arrowSide: CardPosition["arrowSide"] = "top";
  let arrowOffset = 0;

  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;

  const spaceBelow = vh - target.bottom;
  const spaceAbove = target.top;
  const spaceRight = vw - target.right;
  const spaceLeft = target.left;

  let effectivePlacement = placement;

  if (placement === "bottom" && spaceBelow < cardHeight + FLIP_GAP) {
    effectivePlacement = "top";
  } else if (placement === "top" && spaceAbove < cardHeight + FLIP_GAP) {
    effectivePlacement = "bottom";
  } else if (placement === "right" && spaceRight < cardWidth + FLIP_GAP) {
    effectivePlacement = "left";
  } else if (placement === "left" && spaceLeft < cardWidth + FLIP_GAP) {
    effectivePlacement = "right";
  }

  switch (effectivePlacement) {
    case "bottom":
      top = target.bottom + SPOTLIGHT_PADDING + ARROW_SIZE + 4;
      left = targetCenterX - cardWidth / 2;
      arrowSide = "top";
      break;
    case "top":
      top = target.top - SPOTLIGHT_PADDING - cardHeight - ARROW_SIZE - 4;
      left = targetCenterX - cardWidth / 2;
      arrowSide = "bottom";
      break;
    case "right":
      top = targetCenterY - cardHeight / 2;
      left = target.right + SPOTLIGHT_PADDING + ARROW_SIZE + 4;
      arrowSide = "left";
      break;
    case "left":
      top = targetCenterY - cardHeight / 2;
      left = target.left - SPOTLIGHT_PADDING - cardWidth - ARROW_SIZE - 4;
      arrowSide = "right";
      break;
  }

  left = Math.max(CARD_PADDING, Math.min(left, vw - cardWidth - CARD_PADDING));
  top = Math.max(CARD_PADDING, Math.min(top, vh - cardHeight - CARD_PADDING));

  if (arrowSide === "top" || arrowSide === "bottom") {
    arrowOffset = Math.max(16, Math.min(targetCenterX - left, cardWidth - 16));
  } else {
    arrowOffset = Math.max(16, Math.min(targetCenterY - top, cardHeight - 16));
  }

  return { top, left, arrowSide, arrowOffset };
}

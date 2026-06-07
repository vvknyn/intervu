"use client";

import { useTour } from "@/hooks/use-tour";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "@phosphor-icons/react";

const CARD_WIDTH = 320;
const CARD_PADDING = 12;
const SPOTLIGHT_PADDING = 8;
const ARROW_SIZE = 8;

interface CardPosition {
  top: number;
  left: number;
  arrowSide: "top" | "bottom" | "left" | "right";
  arrowOffset: number;
}

function computeCardPosition(
  rect: DOMRect,
  placement: "top" | "bottom" | "left" | "right",
  cardHeight: number
): CardPosition {
  if (typeof window === 'undefined') return { top: 0, left: 0, arrowSide: "top", arrowOffset: 0 };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;
  let arrowSide: CardPosition["arrowSide"] = "top";
  let arrowOffset = 0;

  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;

  // Try the preferred placement first, then flip if needed
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  const spaceRight = vw - rect.right;
  const spaceLeft = rect.left;

  let effectivePlacement = placement;

  if (placement === "bottom" && spaceBelow < cardHeight + 20) {
    effectivePlacement = "top";
  } else if (placement === "top" && spaceAbove < cardHeight + 20) {
    effectivePlacement = "bottom";
  } else if (placement === "right" && spaceRight < CARD_WIDTH + 20) {
    effectivePlacement = "left";
  } else if (placement === "left" && spaceLeft < CARD_WIDTH + 20) {
    effectivePlacement = "right";
  }

  switch (effectivePlacement) {
    case "bottom":
      top = rect.bottom + SPOTLIGHT_PADDING + ARROW_SIZE + 4;
      left = targetCenterX - CARD_WIDTH / 2;
      arrowSide = "top";
      break;
    case "top":
      top = rect.top - SPOTLIGHT_PADDING - cardHeight - ARROW_SIZE - 4;
      left = targetCenterX - CARD_WIDTH / 2;
      arrowSide = "bottom";
      break;
    case "right":
      top = targetCenterY - cardHeight / 2;
      left = rect.right + SPOTLIGHT_PADDING + ARROW_SIZE + 4;
      arrowSide = "left";
      break;
    case "left":
      top = targetCenterY - cardHeight / 2;
      left = rect.left - SPOTLIGHT_PADDING - CARD_WIDTH - ARROW_SIZE - 4;
      arrowSide = "right";
      break;
  }

  // Clamp to viewport
  left = Math.max(CARD_PADDING, Math.min(left, vw - CARD_WIDTH - CARD_PADDING));
  top = Math.max(CARD_PADDING, Math.min(top, vh - cardHeight - CARD_PADDING));

  // Calculate arrow offset to point at target center
  if (arrowSide === "top" || arrowSide === "bottom") {
    arrowOffset = Math.max(16, Math.min(targetCenterX - left, CARD_WIDTH - 16));
  } else {
    arrowOffset = Math.max(16, Math.min(targetCenterY - top, cardHeight - 16));
  }

  return { top, left, arrowSide, arrowOffset };
}

export function TourOverlay() {
  const {
    isActive,
    isMinimized,
    currentStep,
    steps,
    targetRect,
    nextStep,
    prevStep,
    stopTour,
    minimize,
  } = useTour();

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  // Respect prefers-reduced-motion: skip the spring + fades for vestibular safety.
  const reduceMotion = useReducedMotion();

  // Update window size
  useEffect(() => {
    const updateSize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Measure card height
  useEffect(() => {
    if (cardRef.current) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setCardHeight(entry.contentRect.height);
        }
      });
      observer.observe(cardRef.current);
      return () => observer.disconnect();
    }
  }, [isActive, currentStep]);

  if (!isActive || isMinimized || steps.length === 0 || !targetRect) {
    return null;
  }

  const step = steps[currentStep];
  if (!step) return null;

  const isLast = currentStep === steps.length - 1;
  const isFirst = currentStep === 0;
  const progress = ((currentStep + 1) / steps.length) * 100;

  const spotlightX = targetRect.left - SPOTLIGHT_PADDING;
  const spotlightY = targetRect.top - SPOTLIGHT_PADDING;
  const spotlightW = targetRect.width + SPOTLIGHT_PADDING * 2;
  const spotlightH = targetRect.height + SPOTLIGHT_PADDING * 2;
  const radius = 8;

  // Create path for overlay with hole (evenodd rule)
  // Outer rectangle (viewport) + Inner rounded rectangle (hole)
  // We construct the inner rect manually with arcs for rounded corners
  const innerPath = `
    M ${spotlightX + radius} ${spotlightY}
    h ${spotlightW - 2 * radius}
    q ${radius} 0 ${radius} ${radius}
    v ${spotlightH - 2 * radius}
    q 0 ${radius} -${radius} ${radius}
    h -${spotlightW - 2 * radius}
    q -${radius} 0 -${radius} -${radius}
    v -${spotlightH - 2 * radius}
    q 0 -${radius} ${radius} -${radius}
    z
  `;

  // Provide a fallback window size if 0 to prevent issues
  const w = windowSize.width || 1920;
  const h = windowSize.height || 1080;

  const overlayPath = `M 0 0 h ${w} v ${h} h -${w} Z ${innerPath}`;

  const cardPos = computeCardPosition(targetRect, step.placement, cardHeight);

  // Arrow styles
  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
  };

  switch (cardPos.arrowSide) {
    case "top":
      Object.assign(arrowStyle, {
        top: -ARROW_SIZE,
        left: cardPos.arrowOffset - ARROW_SIZE,
        borderLeft: `${ARROW_SIZE}px solid transparent`,
        borderRight: `${ARROW_SIZE}px solid transparent`,
        borderBottom: `${ARROW_SIZE}px solid var(--color-card, white)`,
      });
      // Adjust standard border color for dark mode or specific themes if needed
      // but usually card background var is best. Here we hardcode fallback.
      break;
    case "bottom":
      Object.assign(arrowStyle, {
        bottom: -ARROW_SIZE,
        left: cardPos.arrowOffset - ARROW_SIZE,
        borderLeft: `${ARROW_SIZE}px solid transparent`,
        borderRight: `${ARROW_SIZE}px solid transparent`,
        borderTop: `${ARROW_SIZE}px solid var(--color-card, white)`,
      });
      break;
    case "left":
      Object.assign(arrowStyle, {
        left: -ARROW_SIZE,
        top: cardPos.arrowOffset - ARROW_SIZE,
        borderTop: `${ARROW_SIZE}px solid transparent`,
        borderBottom: `${ARROW_SIZE}px solid transparent`,
        borderRight: `${ARROW_SIZE}px solid var(--color-card, white)`,
      });
      break;
    case "right":
      Object.assign(arrowStyle, {
        right: -ARROW_SIZE,
        top: cardPos.arrowOffset - ARROW_SIZE,
        borderTop: `${ARROW_SIZE}px solid transparent`,
        borderBottom: `${ARROW_SIZE}px solid transparent`,
        borderLeft: `${ARROW_SIZE}px solid var(--color-card, white)`,
      });
      break;
  }

  // Use a class for arrow color that matches bg-card
  const arrowClass = `absolute w-0 h-0 
    ${cardPos.arrowSide === 'top' ? 'border-b-[8px] border-l-[8px] border-r-[8px] border-l-transparent border-r-transparent border-b-card' : ''}
    ${cardPos.arrowSide === 'bottom' ? 'border-t-[8px] border-l-[8px] border-r-[8px] border-l-transparent border-r-transparent border-t-card' : ''}
    ${cardPos.arrowSide === 'right' ? 'border-l-[8px] border-y-[8px] border-y-transparent border-l-card' : ''}
    ${cardPos.arrowSide === 'left' ? 'border-r-[8px] border-y-[8px] border-y-transparent border-r-card' : ''}
  `;

  // Calculate arrow position based on offset
  const arrowPosStyle: React.CSSProperties = {};
  if (cardPos.arrowSide === 'top') { arrowPosStyle.top = -8; arrowPosStyle.left = cardPos.arrowOffset - 8; }
  if (cardPos.arrowSide === 'bottom') { arrowPosStyle.bottom = -8; arrowPosStyle.left = cardPos.arrowOffset - 8; }
  if (cardPos.arrowSide === 'left') { arrowPosStyle.left = -8; arrowPosStyle.top = cardPos.arrowOffset - 8; }
  if (cardPos.arrowSide === 'right') { arrowPosStyle.right = -8; arrowPosStyle.top = cardPos.arrowOffset - 8; }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
        {/* SVG Overlay with hole */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-auto"
          onClick={stopTour}
        >
          <motion.path
            d={overlayPath}
            fill="rgba(0,0,0,0.5)"
            fillRule="evenodd"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1, d: overlayPath }} // Animate d for smooth transition
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
          />
        </svg>

        {/* Tooltip card */}
        <motion.div
          ref={cardRef}
          className="absolute pointer-events-auto bg-card text-card-foreground rounded-xl shadow-lg border border-border"
          style={{
            width: CARD_WIDTH,
            top: cardPos.top,
            left: cardPos.left,
            zIndex: 201,
          }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1, top: cardPos.top, left: cardPos.left }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 }}
          key={currentStep}
        >
          {/* Arrow */}
          <div className={arrowClass} style={arrowPosStyle} />

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs text-muted-foreground font-medium">
              Step {currentStep + 1} of {steps.length}
            </span>
            <button
              onClick={stopTour}
              className="p-1 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Close tour"
            >
              <X size={14} weight="bold" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mx-4 h-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-brand"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
            />
          </div>

          {/* Content */}
          <div className="px-4 py-3">
            <h3 className="text-sm font-semibold mb-1">{step.title}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {step.description}
            </p>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between px-4 pb-3">
            <button
              onClick={prevStep}
              disabled={isFirst}
              className="text-xs font-medium px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              Previous
            </button>

            <button
              onClick={minimize}
              className="text-xs font-medium px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Minimize
            </button>

            <button
              onClick={nextStep}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-brand text-brand-foreground hover:opacity-90 transition-opacity"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


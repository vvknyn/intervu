"use client";

import { useTour } from "@/hooks/use-tour";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "@phosphor-icons/react";
import {
  SPOTLIGHT_PADDING,
  computeCardPosition,
  effectiveCardWidth,
  maxCardHeight,
} from "@/components/tour/tour-card-position";

export function TourOverlay() {
  const {
    isActive,
    isMinimized,
    currentStep,
    steps,
    targetRect,
    nextStep,
    prevStep,
    minimize,
    stopTour,
  } = useTour();

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const updateSize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

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
  const isSingleStep = steps.length === 1;
  const progress = ((currentStep + 1) / steps.length) * 100;

  const spotlightX = targetRect.left - SPOTLIGHT_PADDING;
  const spotlightY = targetRect.top - SPOTLIGHT_PADDING;
  const spotlightW = targetRect.width + SPOTLIGHT_PADDING * 2;
  const spotlightH = targetRect.height + SPOTLIGHT_PADDING * 2;
  const radius = 8;

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

  const w = windowSize.width || 1920;
  const h = windowSize.height || 1080;

  const overlayPath = `M 0 0 h ${w} v ${h} h -${w} Z ${innerPath}`;

  const cardWidth = effectiveCardWidth(w);
  const cardMaxHeight = maxCardHeight(h);
  const effectiveCardHeight = Math.min(cardHeight, cardMaxHeight);

  const cardPos = computeCardPosition(
    { width: w, height: h },
    targetRect,
    step.placement,
    effectiveCardHeight,
    cardWidth,
  );

  const arrowClass = `absolute w-0 h-0 
    ${cardPos.arrowSide === "top" ? "border-b-[8px] border-l-[8px] border-r-[8px] border-l-transparent border-r-transparent border-b-card" : ""}
    ${cardPos.arrowSide === "bottom" ? "border-t-[8px] border-l-[8px] border-r-[8px] border-l-transparent border-r-transparent border-t-card" : ""}
    ${cardPos.arrowSide === "right" ? "border-l-[8px] border-y-[8px] border-y-transparent border-l-card" : ""}
    ${cardPos.arrowSide === "left" ? "border-r-[8px] border-y-[8px] border-y-transparent border-r-card" : ""}
  `;

  const arrowPosStyle: React.CSSProperties = {};
  if (cardPos.arrowSide === "top") {
    arrowPosStyle.top = -8;
    arrowPosStyle.left = cardPos.arrowOffset - 8;
  }
  if (cardPos.arrowSide === "bottom") {
    arrowPosStyle.bottom = -8;
    arrowPosStyle.left = cardPos.arrowOffset - 8;
  }
  if (cardPos.arrowSide === "left") {
    arrowPosStyle.left = -8;
    arrowPosStyle.top = cardPos.arrowOffset - 8;
  }
  if (cardPos.arrowSide === "right") {
    arrowPosStyle.right = -8;
    arrowPosStyle.top = cardPos.arrowOffset - 8;
  }

  return (
    <AnimatePresence>
      {/* dialog-primitive-exempt: pointer-events-none spotlight layer, not a dialog */}
      <div className="fixed inset-0 z-[200] pointer-events-none">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-auto"
          onClick={minimize}
        >
          <motion.path
            d={overlayPath}
            fill="rgba(0,0,0,0.5)"
            fillRule="evenodd"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
          />
        </svg>

        <motion.div
          ref={cardRef}
          className="absolute pointer-events-auto flex flex-col bg-card text-card-foreground rounded-none border border-border"
          style={{
            width: cardWidth,
            maxHeight: cardMaxHeight,
            top: cardPos.top,
            left: cardPos.left,
            zIndex: 201,
          }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1, top: cardPos.top, left: cardPos.left }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 }
          }
          key={currentStep}
        >
          <div className={arrowClass} style={arrowPosStyle} />

          <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </span>
            <button
              onClick={minimize}
              className="p-1 -mr-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close tour"
            >
              <X weight="bold" />
            </button>
          </div>

          <div className="mx-4 h-1 shrink-0 rounded-none bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-none bg-brand"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <h3 className="shrink-0 text-sm font-semibold mb-1">{step.title}</h3>
            <p className="min-h-0 flex-1 overflow-y-auto text-xs text-muted-foreground leading-relaxed">
              {step.description}
            </p>
          </div>

          <div className="flex shrink-0 items-center justify-between px-4 pb-3">
            {!isSingleStep ? (
              <button
                onClick={prevStep}
                disabled={isFirst}
                className="ctl-md text-xs px-3 rounded-none text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                Previous
              </button>
            ) : (
              <span aria-hidden className="w-[72px]" />
            )}

            {!isSingleStep && (
            <button
              onClick={minimize}
              className="ctl-md text-xs px-2 rounded-none text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Minimize
            </button>
            )}

            {isSingleStep && <span aria-hidden className="flex-1" />}

            <button
              onClick={isSingleStep ? stopTour : nextStep}
              className="ctl-md text-xs font-semibold px-3 rounded-none bg-brand text-brand-foreground hover:opacity-90 transition-opacity"
            >
              {isSingleStep ? "Close" : isLast ? "Finish" : "Next"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

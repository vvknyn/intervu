"use client";

import dynamic from "next/dynamic";
import { useTour } from "@/hooks/use-tour";

/**
 * The card draws with framer-motion, which is about 350 KB, and used to be
 * downloaded and run on every page a few seconds after load although a tour
 * shows on a small share of visits: a browser coverage run of /pricing counted
 * about 240 KB of it as never executed. It now loads the first time a tour is
 * actually showing, and never otherwise.
 */
const TourOverlayCard = dynamic(() => import("@/components/tour/TourOverlayCard").then((m) => ({ default: m.TourOverlayCard })), {
    ssr: false,
});

/** Mounts the tour overlay only while a tour is on screen (the same conditions the card itself draws under). */
export function TourOverlay() {
    const { isActive, isMinimized, steps, targetRect } = useTour();
    if (!isActive || isMinimized || steps.length === 0 || !targetRect) return null;
    return <TourOverlayCard />;
}

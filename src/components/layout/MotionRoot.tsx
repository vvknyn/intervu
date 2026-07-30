"use client";

import { LayoutGroup } from "framer-motion";

/** Shared layout scope so the empty-state wordmark can morph into TopBar. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
    return <LayoutGroup id="intervu">{children}</LayoutGroup>;
}

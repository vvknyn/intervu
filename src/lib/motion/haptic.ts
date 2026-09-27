import { prefersReducedMotion } from "./interaction-contract";

export type HapticKind = "light" | "success";

const VIBRATE_MS: Record<HapticKind, number | number[]> = {
    light: 10,
    success: [12, 40, 12],
};

/** Best-effort tactile feedback — no-op when reduced motion or vibrate unavailable. */
export function hapticTap(kind: HapticKind = "light"): void {
    if (typeof navigator === "undefined") return;
    if (prefersReducedMotion()) return;
    if (typeof navigator.vibrate !== "function") return;
    try {
        navigator.vibrate(VIBRATE_MS[kind]);
    } catch {
        /* ignored */
    }
}

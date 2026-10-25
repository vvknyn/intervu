import type { Locator } from "@playwright/test";

/**
 * Wait out an overlay's open animation before measuring it: a box read mid slide-in lies about where the
 * panel ends up. A cancelled animation (the overlay re-renders as it opens) rejects `finished`; that one is done too.
 */
export async function settled(el: Locator) {
  await el.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
}

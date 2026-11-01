import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * The phone dock, measured as the browser laid it out (J-MOB-30, J-MOB-31).
 *
 * Every bar pinned to the bottom of a phone screen is one frame: a floating
 * glass capsule inset from both sides (`dock-capsule`, globals.css). The probe
 * does not look for a class or a test id, so it covers a bar nobody has written
 * yet: it takes every element the browser holds `fixed` or `sticky`, that can
 * be touched, that is wide and short enough to be a bar, and that sits in the
 * lower half of the screen, then checks each one against the frame and the
 * stack against itself.
 */
export type PinnedBar = {
  name: string;
  left: number;
  right: number;
  /** Distance from the bottom edge of the screen to the bar's bottom. */
  bottom: number;
  width: number;
  height: number;
  radius: number;
  blur: string;
  /** The fill's alpha: 1 is a slab, near 0 is nothing. */
  alpha: number;
};

/** Every pinned bottom bar in `root` (the whole page by default), lowest first. */
export function pinnedBottomBars(page: Page, root?: Locator): Promise<PinnedBar[]> {
  const read = (scope?: Element) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return [...(scope ?? document).querySelectorAll<HTMLElement>("*")]
      .map((el) => ({ el, cs: getComputedStyle(el), r: el.getBoundingClientRect() }))
      .filter(
        ({ cs, r }) =>
          (cs.position === "fixed" || cs.position === "sticky") &&
          cs.visibility === "visible" &&
          cs.display !== "none" &&
          cs.pointerEvents !== "none" &&
          r.width >= vw * 0.5 &&
          r.height > 0 &&
          r.height <= 160 &&
          r.top >= vh * 0.5 &&
          r.bottom <= vh + 1,
      )
      .map(({ el, cs, r }) => ({
        name: el.getAttribute("data-testid") ?? `${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/)[0] ?? ""}`,
        left: r.left,
        right: vw - r.right,
        bottom: vh - r.bottom,
        width: r.width,
        height: r.height,
        radius: parseFloat(cs.borderTopLeftRadius),
        blur: cs.backdropFilter || (cs as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "none",
        alpha: Number(cs.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1),
      }))
      .sort((a, b) => a.bottom - b.bottom);
  };
  return root ? root.evaluate(read) : page.evaluate(read, undefined);
}

/**
 * The frame rule. `bars` are what `pinnedBottomBars` found; `expectCount` says
 * how many this screen should hold (a count that drops to zero is a bar that
 * stopped being found, which would pass every other check).
 */
export function expectDockFrame(bars: PinnedBar[], expectCount: number) {
  expect(bars.map((b) => b.name), "pinned bottom bars found on screen").toHaveLength(expectCount);
  for (const bar of bars) {
    const at = `${bar.name}: ${JSON.stringify(bar)}`;
    // A capsule inset from both sides, level. The Apply bar was a flush band across the full width (2026-11-01).
    expect(bar.left, `${at} left inset`).toBeGreaterThanOrEqual(12);
    expect(bar.right, `${at} right inset`).toBeGreaterThanOrEqual(12);
    expect(Math.abs(bar.left - bar.right), `${at} centred`).toBeLessThanOrEqual(1);
    expect(bar.radius, `${at} capsule radius`).toBeGreaterThanOrEqual(bar.height / 2);
    // Glass: a blur over a fill you can see through. 0.94 read as a black band with hard edges; 0.82 as a dark slab.
    expect(bar.blur, `${at} blur`).toContain("blur");
    expect(bar.alpha, `${at} fill alpha`).toBeGreaterThan(0.3);
    expect(bar.alpha, `${at} fill alpha`).toBeLessThan(0.9);
  }
  // One family: every capsule is the same width.
  expect(new Set(bars.map((b) => Math.round(b.width))).size, `capsule widths ${bars.map((b) => Math.round(b.width))}`).toBe(1);
  // One stack from the bottom edge: the lowest is lifted off it, each next one sits just above the last, none overlapping.
  expect(bars[0]!.bottom, "the lowest capsule's lift off the bottom edge").toBeGreaterThanOrEqual(19);
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i]!.bottom - (bars[i - 1]!.bottom + bars[i - 1]!.height);
    expect(gap, `gap between ${bars[i - 1]!.name} and ${bars[i]!.name}`).toBeGreaterThanOrEqual(4);
    expect(gap, `gap between ${bars[i - 1]!.name} and ${bars[i]!.name}`).toBeLessThanOrEqual(16);
  }
}

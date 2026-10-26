import type { Locator, Page } from "@playwright/test";

/**
 * Pixel sampler for a state indicator (selected-row ring, keyboard focus ring) drawn inside a row's box.
 *
 * It screenshots the row at the page's device-pixel ratio and reads, along each of the four edges, the line of
 * pixels through the middle of the indicator (`widthCss` CSS px wide, flush with the row's edge). It reports the
 * share of each line that is the indicator's colour, so a ring that a descendant's border or background paints
 * over (an inset box-shadow does not paint above its children) reads as a break instead of passing on the
 * computed style, which says "ring" either way.
 */
export type EdgeMatch = { top: number; right: number; bottom: number; left: number };

export const EDGE_PASS_PERCENT = 98;

export async function edgeMatch(page: Page, row: Locator, colorVar: string, widthCss: number): Promise<EdgeMatch> {
  await row.scrollIntoViewIfNeeded();
  const measure = () =>
    row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      // Page coordinates: a screenshot clip is measured from the document's top-left, not the viewport's.
      return { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY, dpr: window.devicePixelRatio };
    });
  // The list settles for a moment after it paints (late sections shift it): sample only once the row holds still.
  let geo = await measure();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const next = await measure();
    const still = JSON.stringify(next) === JSON.stringify(geo);
    geo = next;
    if (still) break;
  }
  const x0 = Math.floor(geo.left);
  const y0 = Math.floor(geo.top);
  const png = await page.screenshot({
    clip: { x: x0, y: y0, width: Math.ceil(geo.right) - x0, height: Math.ceil(geo.bottom) - y0 },
    scale: "device",
  });
  return page.evaluate(
    async ([b64, colorVarName, width, g, ox, oy]) => {
      const probe = document.createElement("span");
      probe.style.color = `rgb(var(${colorVarName}))`;
      document.body.append(probe);
      const want = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
      probe.remove();
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // within 40 per channel: antialiasing and the tint under a 1px line never reach that
      const hit = (x: number, y: number) =>
        [0, 1, 2].every((k) => Math.abs(data[(y * canvas.width + x) * 4 + k] - want[k]) <= 40);
      const share = (pixels: Array<[number, number]>) => (100 * pixels.filter(([x, y]) => hit(x, y)).length) / pixels.length;
      const d = g.dpr;
      const mid = (width * d) / 2; // device px from the row's edge to the middle of the indicator
      const L = (g.left - ox) * d, R = (g.right - ox) * d, T = (g.top - oy) * d, B = (g.bottom - oy) * d;
      // The last 16 CSS px at each end of an edge are left out: a row in a rounded list card has its corners clipped by the card.
      const span = (a: number, b: number) => {
        const lo = Math.ceil(a + 16 * d), hi = Math.floor(b - 16 * d);
        return Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i);
      };
      const col = (x: number, ys: number[]) => ys.map((y): [number, number] => [x, y]);
      const rowOf = (y: number, xs: number[]) => xs.map((x): [number, number] => [x, y]);
      return {
        top: share(rowOf(Math.floor(T + mid), span(L, R))),
        bottom: share(rowOf(Math.floor(B - mid), span(L, R))),
        left: share(col(Math.floor(L + mid), span(T, B))),
        right: share(col(Math.floor(R - mid), span(T, B))),
      };
    },
    [png.toString("base64"), colorVar, widthCss, geo, x0, y0] as const,
  );
}

/** Pure: the edges that fall below the pass line, as "bottom 25.7%" strings (empty when the indicator is whole). */
export function brokenEdges(m: EdgeMatch): string[] {
  return (Object.keys(m) as Array<keyof EdgeMatch>)
    .filter((k) => m[k] < EDGE_PASS_PERCENT)
    .map((k) => `${k} ${m[k].toFixed(1)}%`);
}

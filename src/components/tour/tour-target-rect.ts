export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectsEqual(
  a: RectBounds | null | undefined,
  b: RectBounds | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

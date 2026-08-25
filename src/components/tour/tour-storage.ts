const STORAGE_KEY = "intervu-tour-state";

export type TourStorage = {
  seen: Record<string, boolean>;
  minimized?: { tourId: string; step: number };
};

function emptyStorage(): TourStorage {
  return { seen: {} };
}

export function readTourStorage(): TourStorage {
  if (typeof localStorage === "undefined") return emptyStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStorage();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyStorage();

    if ("seen" in parsed && parsed.seen && typeof parsed.seen === "object") {
      const record = parsed as TourStorage;
      return {
        seen: record.seen,
        minimized: record.minimized,
      };
    }

    return { seen: parsed as Record<string, boolean> };
  } catch {
    return emptyStorage();
  }
}

function writeStorage(storage: TourStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch {
    // storage full or blocked
  }
}

export function markTourSeen(tourId: string): void {
  const storage = readTourStorage();
  storage.seen[tourId] = true;
  writeStorage(storage);
}

export function writeTourMinimized(tourId: string, step: number): void {
  const storage = readTourStorage();
  storage.seen[tourId] = true;
  storage.minimized = { tourId, step };
  writeStorage(storage);
}

export function clearTourMinimized(): void {
  const storage = readTourStorage();
  if (!storage.minimized) return;
  delete storage.minimized;
  writeStorage(storage);
}

export function hasSeenTourId(tourId: string): boolean {
  return !!readTourStorage().seen[tourId];
}

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  readTourStorage,
  markTourSeen,
  writeTourMinimized,
  clearTourMinimized,
  hasSeenTourId,
} from "../../src/components/tour/tour-storage";

const STORAGE_KEY = "intervu-tour-state";
const PROVIDER = path.join(process.cwd(), "src/components/tour/TourProvider.tsx");
const OVERLAY = path.join(process.cwd(), "src/components/tour/TourOverlay.tsx");

class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage =
  fakeLocalStorage;

beforeEach(() => {
  fakeLocalStorage.clear();
});

test("tour storage", async (t) => {
  await t.test("legacy { jobs: true } → hasSeenTourId('jobs') true", () => {
    fakeLocalStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs: true }));
    assert.equal(hasSeenTourId("jobs"), true);
    assert.equal(readTourStorage().seen.jobs, true);
  });

  await t.test("writeTourMinimized marks seen and stores minimized slot", () => {
    writeTourMinimized("jobs", 2);
    const storage = readTourStorage();
    assert.equal(storage.seen.jobs, true);
    assert.deepEqual(storage.minimized, { tourId: "jobs", step: 2 });
    assert.equal(hasSeenTourId("jobs"), true);
  });

  await t.test("clearTourMinimized keeps seen", () => {
    writeTourMinimized("jobs", 2);
    clearTourMinimized();
    const storage = readTourStorage();
    assert.equal(storage.seen.jobs, true);
    assert.equal(storage.minimized, undefined);
    assert.equal(hasSeenTourId("jobs"), true);
  });

  await t.test("corrupt JSON → empty, no throw", () => {
    fakeLocalStorage.setItem(STORAGE_KEY, "{not json");
    assert.doesNotThrow(() => readTourStorage());
    assert.deepEqual(readTourStorage(), { seen: {} });
    assert.equal(hasSeenTourId("jobs"), false);
  });

  await t.test("TourOverlay dismiss uses minimize not stopTour", () => {
    const src = readFileSync(OVERLAY, "utf8");
    const svgClick = src.match(/<svg[\s\S]*?onClick=\{(\w+)\}/);
    assert.ok(svgClick, "backdrop svg onClick must exist");
    assert.equal(svgClick![1], "minimize", "backdrop click must minimize");
    assert.match(src, /aria-label="Close tour"[\s\S]*?onClick=\{minimize\}/);
    assert.doesNotMatch(
      src,
      /aria-label="Close tour"[\s\S]*?onClick=\{stopTour\}/,
    );
  });

  await t.test("TourProvider Escape calls minimizeTour", () => {
    const src = readFileSync(PROVIDER, "utf8");
    assert.match(src, /e\.key === "Escape"[\s\S]*?minimizeTour\(\)/);
  });
});

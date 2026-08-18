import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

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
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;
// launch-banner.ts gates on `typeof window === "undefined"` to stay
// SSR-safe — a plain node:test process has no DOM, so without this stub
// every read/write would silently take the "server" branch and the
// localStorage path would never run (same stub visit-cursor.test.ts uses).
(globalThis as unknown as { window: unknown }).window = globalThis;

import { readLaunchBannerDismissed, writeLaunchBannerDismissed } from "../../src/lib/jobs/launch-banner";
import { LaunchBannerContent } from "../../src/components/jobs/LaunchBanner";

beforeEach(() => {
    fakeLocalStorage.clear();
});

test("never dismissed: reads as not-dismissed (banner renders)", () => {
    assert.equal(readLaunchBannerDismissed(), false);
});

test("dismiss action sets the flag", () => {
    writeLaunchBannerDismissed();
    assert.equal(fakeLocalStorage.getItem("intervu.launchBanner.dismissed"), "true");
});

test("flag set: reads as dismissed (banner hidden)", () => {
    writeLaunchBannerDismissed();
    assert.equal(readLaunchBannerDismissed(), true);
});

test("class case: a corrupt/unparseable stored value falls back to SHOWING, never throws", () => {
    fakeLocalStorage.setItem("intervu.launchBanner.dismissed", "{not-valid-json::");
    assert.doesNotThrow(() => readLaunchBannerDismissed());
    assert.equal(readLaunchBannerDismissed(), false);
});

test("an unrelated truthy-looking value ('1', 'TRUE') is not treated as dismissed", () => {
    fakeLocalStorage.setItem("intervu.launchBanner.dismissed", "1");
    assert.equal(readLaunchBannerDismissed(), false);
    fakeLocalStorage.setItem("intervu.launchBanner.dismissed", "TRUE");
    assert.equal(readLaunchBannerDismissed(), false);
});

test("render: the banner links to /connect", () => {
    const html = renderToStaticMarkup(LaunchBannerContent({ onDismiss: () => {} }));
    assert.match(html, /href="\/connect"/);
});

test("render: the dismiss control is a real, labeled button", () => {
    const html = renderToStaticMarkup(LaunchBannerContent({ onDismiss: () => {} }));
    assert.match(html, /<button[^>]*aria-label="Dismiss launch banner"/);
});

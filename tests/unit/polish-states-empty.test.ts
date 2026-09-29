import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRACKER_FILTER_EMPTY } from "../../src/lib/pursuits/tracker-voice-copy";

const ROOT = join(__dirname, "../..");

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

describe("polish batch 3 — states and empties", () => {
    it("loaded and pending for-you roots share jobs-session-frame", () => {
        const home = read("src/components/jobs/for-you/ForYouHome.tsx");
        assert.match(home, /JOBS_SESSION_FRAME_CLASS[\s\S]*data-testid="for-you-home"/);
        assert.match(home, /JOBS_SESSION_FRAME_CLASS[\s\S]*data-testid="for-you-home-pending"/);
        assert.match(home, /state-opacity-in/);
    });

    it("session shell exposes warm loading copy and session paper slot", () => {
        const shell = read("src/components/layout/jobs-session-loading.tsx");
        const labelMatch = shell.match(
            /const SESSION_LOADING_LABEL = "([^"]+)";/,
        );
        assert.ok(labelMatch, "SESSION_LOADING_LABEL must be a named constant");
        assert.equal(labelMatch[1], "Loading your session…");
        assert.match(shell, /sr-only[\s\S]*?\{SESSION_LOADING_LABEL\}/);
        assert.match(shell, /statusLabel=\{SESSION_LOADING_LABEL\}/);
        assert.match(shell, /data-testid="jobs-session-loading-status"/);
        assert.match(shell, /for-you-deck-paper-raised/);
        assert.match(shell, /poster-noise/);
        assert.match(shell, /role="status"/);
        assert.match(shell, /aria-busy="true"/);
    });

    it("ForYouHomePending delegates to JobsSessionLoadingShell", () => {
        const home = read("src/components/jobs/for-you/ForYouHome.tsx");
        assert.match(home, /ForYouHomePending[\s\S]*JobsSessionLoadingShell/);
    });

    it("for-you empty omits search CTA when showSearchCta is false", () => {
        const home = read("src/components/jobs/for-you/ForYouHome.tsx");
        assert.match(home, /showSearchCta\s*\?/);
        assert.match(home, /for-you-empty-search-cta/);
    });

    it("guest tracker empty keeps auth footer conveyor", () => {
        const yours = read("src/app/yours/page.tsx");
        assert.match(yours, /yours-guest-empty/);
        assert.match(yours, /AUTH_CTA_LABEL/);
        assert.match(yours, /guestKeepLine/);
        assert.match(yours, /footer=\{/);
    });

    it("ConceptAEmptyState adopted on tracker, history, and for-you deck empty", () => {
        assert.match(read("src/app/yours/page.tsx"), /ConceptAEmptyState/);
        assert.match(read("src/app/yours/history/page.tsx"), /ConceptAEmptyState[\s\S]*history-empty/);
        assert.match(read("src/components/jobs/for-you/ForYouHome.tsx"), /ConceptAEmptyState[\s\S]*for-you-empty/);
    });

    it("zero-data tracker hides search and lane chrome; populated keeps them", () => {
        const yours = read("src/app/yours/page.tsx");
        assert.match(yours, /pursuits\.length > 0[\s\S]*data-testid="tracker-search"/);
        assert.match(yours, /pursuits\.length === 0[\s\S]*TrackerEmptyState/);
        assert.doesNotMatch(
            yours,
            /pursuits\.length === 0[\s\S]*data-testid="tracker-search"/,
            "empty tracker must not render search",
        );
        assert.equal(TRACKER_FILTER_EMPTY, "Nothing in this lane.");
        assert.match(yours, /TRACKER_FILTER_EMPTY/);
        assert.match(yours, /\{TRACKER_FILTER_EMPTY\}/);
    });

    it("tracker and history use after-controls slot; for-you uses page placement", () => {
        assert.match(read("src/app/yours/page.tsx"), /ConceptAEmptyPageSlot[\s\S]*placement="after-controls"[\s\S]*TrackerEmptyState/);
        assert.match(
            read("src/app/yours/history/page.tsx"),
            /ConceptAEmptyPageSlot[\s\S]*placement="after-controls"[\s\S]*HistoryEmptyState/,
        );
        assert.match(read("src/components/jobs/for-you/ForYouHome.tsx"), /ConceptAEmptyPageSlot[\s\S]*placement="page"/);
        const mock = read("src/components/mock/EmptyStatesMock.tsx");
        assert.match(mock, /surface === "tracker"[\s\S]*placement="after-controls"/);
        assert.match(mock, /surface === "history"[\s\S]*placement="after-controls"/);
    });

    it("search zero-results uses compact centered ConceptAEmptyState and keeps chip testids", () => {
        const page = read("src/app/jobs/JobsContent.tsx");
        assert.match(page, /ConceptAEmptyPageSlot[\s\S]*className="pb-4 pt-6"/);
        assert.match(page, /ConceptAEmptyState[\s\S]*density="compact"/);
        assert.doesNotMatch(page, /ConceptAEmptyState[\s\S]*layout="inline"/);
        assert.match(page, /justify-center text-center/);
        assert.match(page, /No roles match\./);
        assert.match(page, /empty-state-clear-chip/);
        assert.match(page, /data-testid="search-empty-results"/);
        const mock = read("src/components/mock/EmptyStatesMock.tsx");
        assert.match(mock, /ConceptAEmptyState[\s\S]*search-empty-results/);
        assert.doesNotMatch(mock, /layout="inline"/);
    });

    it("session loading status is prominent with live indicator", () => {
        const shell = read("src/components/layout/jobs-session-loading.tsx");
        assert.match(shell, /statusProminent/);
        assert.match(shell, /bg-live instrument-breathe/);
        assert.match(shell, /text-body-sm font-semibold text-foreground/);
    });

    it("inline empty illustration is decorative", () => {
        const ill = read("src/components/ui/concept-a-empty-illustration.tsx");
        assert.match(ill, /aria-hidden/);
        assert.doesNotMatch(ill, /from ["']@\/public/);
        assert.doesNotMatch(ill, /lottie/i);
    });

    it("offline shell is honest client boundary — alert + retry, no service worker", () => {
        const offline = read("src/components/layout/offline-shell.tsx");
        assert.match(offline, /role="alert"/);
        assert.match(offline, /location\.reload/);
        assert.match(offline, /You&apos;re offline/);
        assert.doesNotMatch(offline, /serviceWorker\.register/);
        assert.doesNotMatch(offline, /navigator\.serviceWorker/);
    });

    it("layout mounts OfflineShell once and paints charcoal before CSS", () => {
        // 59a7aa86 idle-defers OfflineShell: layout mounts IdleDeferredWidgets, which mounts it once.
        const layout = read("src/app/layout.tsx");
        assert.equal(layout.match(/<IdleDeferredWidgets\s*\/>/g)?.length, 1);
        assert.equal(read("src/components/providers/IdleDeferredWidgets.tsx").match(/<OfflineShell\s*\/>/g)?.length, 1);
        assert.match(layout, /#0B0D12/);
    });

    it("404 and error routes use enter-reveal on status panel", () => {
        assert.match(read("src/app/not-found.tsx"), /enter-reveal/);
        assert.match(read("src/app/error.tsx"), /enter-reveal/);
        assert.match(read("src/app/global-error.tsx"), /enter-reveal/);
    });

    it("mock gallery is canonical for offline (no duplicate /mock/offline route)", () => {
        const mock = read("src/app/mock/empty-states/page.tsx");
        assert.match(mock, /EmptyStatesMock/);
        assert.match(read("src/components/mock/EmptyStatesMock.tsx"), /surface === "offline"/);
        try {
            read("src/app/mock/offline/page.tsx");
            assert.fail("duplicate /mock/offline route should be removed");
        } catch (err: unknown) {
            assert.ok(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT");
        }
    });
});

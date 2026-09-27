import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

    it("search zero-results keeps chip testids and adds inline illustration", () => {
        const page = read("src/app/jobs/page.tsx");
        assert.match(page, /ConceptAEmptyIllustration/);
        assert.match(page, /empty-state-clear-chip/);
        assert.match(page, /data-testid="search-empty-results"/);
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
        const layout = read("src/app/layout.tsx");
        assert.match(layout, /<OfflineShell\s*\/>/);
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

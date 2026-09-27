import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

/** Batch 3 touched sources — ratchet-sensitive; no arbitrary padding/size utilities. */
const BATCH3_SOURCES = [
    "src/components/ui/concept-a-empty-illustration.tsx",
    "src/components/ui/concept-a-empty-state.tsx",
    "src/components/ui/empty-state.tsx",
    "src/components/layout/jobs-session-loading.tsx",
    "src/components/layout/offline-shell.tsx",
    "src/components/jobs/for-you/ForYouHome.tsx",
    "src/components/mock/EmptyStatesMock.tsx",
    "src/app/jobs/loading.tsx",
    "src/app/mock/empty-states/page.tsx",
    "src/app/not-found.tsx",
    "src/app/error.tsx",
    "src/app/global-error.tsx",
] as const;

/** Off-token families from scripts/design/off-token-counts.cjs — scoped to Batch 3 files. */
const ARBITRARY_PADDING = /\bp[xytrbl]?-\[/;
const ARBITRARY_SIZE = /\b(?:min-|max-)?[wh]-\[/;

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

describe("polish batch 3 — design contract", () => {
    for (const rel of BATCH3_SOURCES) {
        it(`${rel} forbids arbitrary padding/size utilities`, () => {
            const src = read(rel);
            assert.doesNotMatch(
                src,
                ARBITRARY_PADDING,
                `${rel} must use named inset classes (e.g. poster-list-inset-x), not px-[…]`,
            );
            assert.doesNotMatch(
                src,
                ARBITRARY_SIZE,
                `${rel} must use named layout classes (e.g. jobs-session-scroll), not max-h-[…]`,
            );
        });
    }

    it("jobs-session-frame min-height is tokenized in globals (no layout arbitrary min-h)", () => {
        assert.match(GLOBALS, /\.jobs-session-frame[\s\S]*min-height:\s*min\(72dvh,\s*720px\)/);
        const session = read("src/components/layout/jobs-session-loading.tsx");
        assert.match(session, /JOBS_SESSION_FRAME_CLASS\s*=\s*"jobs-session-frame"/);
        assert.match(session, /JOBS_SESSION_SCROLL_CLASS\s*=\s*"jobs-session-scroll"/);
        assert.match(session, /jobs-session-scroll/);
        assert.doesNotMatch(session, /max-h-\[/);
    });

    it("jobs route loader uses named shell width and list inset classes", () => {
        const loading = read("src/app/jobs/loading.tsx");
        assert.match(loading, /posterListInsetClassName/);
        assert.match(loading, /shellMaxWidthClassName/);
        assert.doesNotMatch(loading, /px-\[var\(--list-inset\)\]/);
        assert.doesNotMatch(loading, /max-w-\[var\(--shell-max\)\]/);
        assert.match(GLOBALS, /\.poster-list-inset-x[\s\S]*padding-inline:\s*var\(--list-inset\)/);
        assert.match(GLOBALS, /\.shell-max-width[\s\S]*max-width:\s*var\(--shell-max\)/);
        assert.match(GLOBALS, /\.jobs-session-scroll[\s\S]*max-height:\s*min\(60dvh,\s*640px\)/);
    });

    it("state-opacity-in is opacity-only (no translate)", () => {
        assert.match(GLOBALS, /\.state-opacity-in/);
        assert.match(GLOBALS, /@keyframes state-opacity-in[\s\S]*opacity:\s*0/);
        assert.doesNotMatch(
            GLOBALS.match(/@keyframes state-opacity-in[\s\S]*?\}/)?.[0] ?? "",
            /transform/,
        );
    });

    it("deck skeleton uses paper-slot classes, not inline shadow utilities", () => {
        const session = read("src/components/layout/jobs-session-loading.tsx");
        assert.match(session, /for-you-deck-paper-postcard/);
        assert.match(session, /for-you-deck-paper-raised/);
        assert.doesNotMatch(session, /shadow-\[/);
    });

    it("empty illustration uses live token, not hex literals", () => {
        const ill = read("src/components/ui/concept-a-empty-illustration.tsx");
        assert.match(ill, /fill-live/);
        assert.doesNotMatch(ill, /#[0-9a-fA-F]{3,8}/);
    });

    it("Concept A empty poster uses AuthRaisedPanel (sanctioned raised chrome)", () => {
        const empty = read("src/components/ui/concept-a-empty-state.tsx");
        assert.match(empty, /AuthRaisedPanel/);
        assert.doesNotMatch(empty, /shadow-\[/);
        assert.doesNotMatch(empty, /p-10|p-12/);
    });

    it("offline shell uses AuthRaisedPanel and has no forceVisible API", () => {
        const offline = read("src/components/layout/offline-shell.tsx");
        assert.match(offline, /AuthRaisedPanel/);
        assert.doesNotMatch(offline, /forceVisible/);
        assert.doesNotMatch(offline, /shadow-\[/);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    resolveDeckShortcut,
    type DeckShortcutEvent,
    type ShortcutTargetInfo,
    type ShortcutTargetReader,
} from "../../src/lib/jobs/for-you/deck-keyboard";

/** Stands in for the real DOM-reading default so these tests run with no jsdom. */
const PLAIN_TARGET: ShortcutTargetInfo = { tagName: "DIV", isContentEditable: false, insideDialog: false };
const readFakeTarget = (info: ShortcutTargetInfo): ShortcutTargetReader => () => info;

function event(overrides: Partial<DeckShortcutEvent>): DeckShortcutEvent {
    return {
        key: "",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        defaultPrevented: false,
        target: null,
        ...overrides,
    };
}

describe("resolveDeckShortcut", () => {
    it("maps arrow keys to previous/next", () => {
        assert.equal(resolveDeckShortcut(event({ key: "ArrowRight" }), readFakeTarget(PLAIN_TARGET)), "next");
        assert.equal(resolveDeckShortcut(event({ key: "ArrowLeft" }), readFakeTarget(PLAIN_TARGET)), "previous");
    });

    it("maps J/K (either case) to next/previous", () => {
        assert.equal(resolveDeckShortcut(event({ key: "j" }), readFakeTarget(PLAIN_TARGET)), "next");
        assert.equal(resolveDeckShortcut(event({ key: "J" }), readFakeTarget(PLAIN_TARGET)), "next");
        assert.equal(resolveDeckShortcut(event({ key: "k" }), readFakeTarget(PLAIN_TARGET)), "previous");
        assert.equal(resolveDeckShortcut(event({ key: "K" }), readFakeTarget(PLAIN_TARGET)), "previous");
    });

    it("maps ArrowUp/ArrowDown to previous/next, mirroring Left/Right", () => {
        assert.equal(resolveDeckShortcut(event({ key: "ArrowDown" }), readFakeTarget(PLAIN_TARGET)), "next");
        assert.equal(resolveDeckShortcut(event({ key: "ArrowUp" }), readFakeTarget(PLAIN_TARGET)), "previous");
    });

    it("maps S (either case) to skip", () => {
        assert.equal(resolveDeckShortcut(event({ key: "s" }), readFakeTarget(PLAIN_TARGET)), "skip");
        assert.equal(resolveDeckShortcut(event({ key: "S" }), readFakeTarget(PLAIN_TARGET)), "skip");
    });

    it("is an allowlist: keys reserved for native scrolling are never handled", () => {
        for (const key of [" ", "PageDown"]) {
            assert.equal(resolveDeckShortcut(event({ key }), readFakeTarget(PLAIN_TARGET)), null, key);
        }
    });

    it("covers a key outside every documented shortcut (class-wide, not just the reported ones)", () => {
        for (const key of ["a", "Enter", "Tab", "Escape"]) {
            assert.equal(resolveDeckShortcut(event({ key }), readFakeTarget(PLAIN_TARGET)), null, key);
        }
    });

    it("ignores any modifier held, including Shift", () => {
        assert.equal(
            resolveDeckShortcut(event({ key: "j", ctrlKey: true }), readFakeTarget(PLAIN_TARGET)),
            null,
        );
        assert.equal(
            resolveDeckShortcut(event({ key: "ArrowRight", altKey: true }), readFakeTarget(PLAIN_TARGET)),
            null,
        );
        assert.equal(
            resolveDeckShortcut(event({ key: "s", metaKey: true }), readFakeTarget(PLAIN_TARGET)),
            null,
        );
        assert.equal(
            resolveDeckShortcut(event({ key: "ArrowLeft", shiftKey: true }), readFakeTarget(PLAIN_TARGET)),
            null,
        );
    });

    it("ignores input/textarea/select targets", () => {
        for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
            const target: ShortcutTargetInfo = { tagName, isContentEditable: false, insideDialog: false };
            assert.equal(resolveDeckShortcut(event({ key: "j" }), readFakeTarget(target)), null, tagName);
        }
    });

    it("ignores a contenteditable target regardless of tag", () => {
        const target: ShortcutTargetInfo = { tagName: "DIV", isContentEditable: true, insideDialog: false };
        assert.equal(resolveDeckShortcut(event({ key: "s" }), readFakeTarget(target)), null);
    });

    it("ignores focus inside a [role=dialog]", () => {
        const target: ShortcutTargetInfo = { tagName: "BUTTON", isContentEditable: false, insideDialog: true };
        assert.equal(resolveDeckShortcut(event({ key: "ArrowRight" }), readFakeTarget(target)), null);
    });

    it("ignores an event whose default was already handled elsewhere", () => {
        assert.equal(
            resolveDeckShortcut(event({ key: "j", defaultPrevented: true }), readFakeTarget(PLAIN_TARGET)),
            null,
        );
    });
});

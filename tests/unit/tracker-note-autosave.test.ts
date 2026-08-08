import assert from "node:assert/strict";
import { test } from "node:test";
import { NoteAutosave, type AutosaveScheduler } from "../../src/lib/pursuits/note-autosave";

/** Captures the last scheduled callback instead of running a real timer, so
 *  tests can simulate "wait" by invoking `fire()` synchronously. */
function fakeScheduler(): { scheduler: AutosaveScheduler; fire: () => void; pending: () => boolean } {
    let captured: (() => void) | null = null;
    return {
        scheduler: {
            schedule(fn) {
                captured = fn;
                return {};
            },
            cancel() {
                captured = null;
            },
        },
        fire() {
            const fn = captured;
            captured = null;
            fn?.();
        },
        pending: () => captured !== null,
    };
}

test("edit then wait fires save exactly once", () => {
    const calls: string[] = [];
    const { scheduler, fire } = fakeScheduler();
    const autosave = new NoteAutosave((v) => calls.push(v), 800, scheduler);

    autosave.edit("a");
    autosave.edit("ab");
    autosave.edit("abc");
    assert.equal(calls.length, 0, "should not save before the debounce elapses");

    fire();
    assert.deepEqual(calls, ["abc"], "burst of edits should collapse into a single save with the latest value");
});

test("edit then close flushes the pending edit immediately", () => {
    const calls: string[] = [];
    const { scheduler, pending } = fakeScheduler();
    const autosave = new NoteAutosave((v) => calls.push(v), 800, scheduler);

    autosave.edit("draft");
    assert.equal(pending(), true);

    autosave.flush("draft");
    assert.deepEqual(calls, ["draft"]);
    assert.equal(pending(), false, "flush should cancel the now-redundant timer");
});

test("close with no edits never calls save — the class case: saves fire only when dirty", () => {
    const calls: string[] = [];
    const { scheduler } = fakeScheduler();
    const autosave = new NoteAutosave((v) => calls.push(v), 800, scheduler);

    autosave.flush("unchanged");
    assert.deepEqual(calls, []);
});

test("flush after a save already fired does not re-save (dirty resets on fire)", () => {
    const calls: string[] = [];
    const { scheduler, fire } = fakeScheduler();
    const autosave = new NoteAutosave((v) => calls.push(v), 800, scheduler);

    autosave.edit("a");
    fire();
    assert.equal(calls.length, 1);

    autosave.flush("a");
    assert.equal(calls.length, 1, "flush with no new edit since the last save must not fire again");
});

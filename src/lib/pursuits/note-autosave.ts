/**
 * Debounced autosave for the tracker note field (spec: w1-cluster-B-tracker.md
 * B1, pattern "Autosave"). `PursuitDetailSheet`'s note used to be a
 * textarea + explicit "Save note" button whose `onOpenChange` close did NOT
 * flush — typed notes were silently lost on close. This module owns the
 * WHEN-to-save decision (dirty tracking + debounce), pure enough to
 * unit-test without waiting on a real clock; the actual `setTimeout` is
 * behind the injectable `AutosaveScheduler` seam below so tests can fire it
 * synchronously instead of sleeping 800ms.
 *
 * The component stays thin I/O: it calls `edit()` on every keystroke and
 * `flush()` on sheet close / `beforeunload`, and owns its own
 * "saving…"/"saved" indicator state around the `onSave` callback it passes
 * in (that callback is async — this class only decides WHEN to invoke it).
 */

export interface AutosaveScheduler {
    schedule(fn: () => void, delayMs: number): unknown;
    cancel(handle: unknown): void;
}

const realScheduler: AutosaveScheduler = {
    schedule: (fn, delayMs) => setTimeout(fn, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const NOTE_AUTOSAVE_DELAY_MS = 800;

export class NoteAutosave {
    private dirty = false;
    private timer: unknown = null;

    constructor(
        private readonly onSave: (value: string) => void,
        private readonly delayMs: number = NOTE_AUTOSAVE_DELAY_MS,
        private readonly scheduler: AutosaveScheduler = realScheduler,
    ) {}

    /** Call on every keystroke. Marks dirty and (re)starts the debounce
     *  timer — a fresh edit always cancels whatever was previously
     *  scheduled, so a burst of typing only ever fires one save. */
    edit(value: string): void {
        this.dirty = true;
        if (this.timer !== null) this.scheduler.cancel(this.timer);
        this.timer = this.scheduler.schedule(() => this.fire(value), this.delayMs);
    }

    /** Call on sheet close / `beforeunload`. Saves immediately if there's an
     *  unsaved edit pending; a no-op otherwise — the class case this exists
     *  for is "closing without touching the note must never call save". */
    flush(value: string): void {
        if (this.timer !== null) {
            this.scheduler.cancel(this.timer);
            this.timer = null;
        }
        if (!this.dirty) return;
        this.fire(value);
    }

    private fire(value: string): void {
        this.timer = null;
        this.dirty = false;
        this.onSave(value);
    }
}

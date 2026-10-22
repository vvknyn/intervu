/**
 * A page that must paint rows first can hold the pursuits read until its first search settles (the server
 * actions share one serialized queue, so a read queued ahead of the search delays the rows). Nothing holds by
 * default; a hold always ends, at `maxMs` at the latest, so a search that never settles cannot starve the read.
 */
let hold: { promise: Promise<void>; release: () => void } | null = null;

export function holdPursuitsRead(maxMs: number): void {
    if (hold) return;
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    const timer = setTimeout(releasePursuitsRead, maxMs);
    hold = {
        promise,
        release: () => {
            clearTimeout(timer);
            release();
        },
    };
}

export function releasePursuitsRead(): void {
    hold?.release();
    hold = null;
}

/** Resolves at once when nothing holds, else when the hold ends. */
export function afterPursuitsReadHold(): Promise<void> {
    return hold?.promise ?? Promise.resolve();
}

/**
 * The one way a feature asks the on-device model for text.
 *
 * WebLLM and the Prompt API run one generation at a time, and two features
 * prompting at once (job-description formatting, fit explanations) would
 * otherwise race for the same engine. Every task goes through one serial
 * queue here:
 *
 *   - only when local AI is on and consented (`localAiTaskReady`); nothing
 *     here ever starts a download the person didn't agree to;
 *   - a "visible" task (what the person is looking at) runs before any
 *     "background" one (warming the next role);
 *   - the same `key` while queued or running shares one generation;
 *   - an aborted, timed-out or refused task resolves `null`, so the caller
 *     keeps what it already shows. A timed-out generation still holds the
 *     queue until the engine lets go of it, so two never overlap.
 */

import { readLocalAiConsent } from "./consent";
import { readLocalAiEnabled } from "./flag";
import { generateWithActiveEngine, initLocalAiLadder } from "./ladder";
import type { GenerateOptions, LocalAiEngineId } from "./engines/types";

export type LocalAiTaskPriority = "visible" | "background";

export interface LocalAiTask extends GenerateOptions {
    /** Same key, same answer: a second request joins the first. */
    key: string;
    prompt: string;
    priority?: LocalAiTaskPriority;
    /** Bounds the generation, not the wait in the queue. */
    timeoutMs?: number;
    /** Engines good enough for this task; others resolve null. Default: any. */
    engines?: readonly LocalAiEngineId[];
    signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** How long a task waits for the model to load before giving up. */
const ENGINE_WAIT_MS = 30_000;
/** A generation still running past its timeout frees the queue after this. */
const STUCK_RELEASE_MS = 60_000;

type Entry = {
    key: string;
    prompt: string;
    options: GenerateOptions;
    engines?: readonly LocalAiEngineId[];
    timeoutMs: number;
    priority: LocalAiTaskPriority;
    waiters: number;
    started: boolean;
    settle: (value: string | null) => void;
    result: Promise<string | null>;
};

const queue: Entry[] = [];
const byKey = new Map<string, Entry>();
let draining = false;

export function localAiTaskReady(): boolean {
    return readLocalAiEnabled() && readLocalAiConsent();
}

function enqueue(entry: Entry): void {
    if (entry.priority === "background") {
        queue.push(entry);
        return;
    }
    const firstBackground = queue.findIndex((e) => e.priority === "background");
    queue.splice(firstBackground === -1 ? queue.length : firstBackground, 0, entry);
}

function promote(entry: Entry): void {
    if (entry.started || entry.priority === "visible") return;
    queue.splice(queue.indexOf(entry), 1);
    entry.priority = "visible";
    enqueue(entry);
}

function cancel(entry: Entry): void {
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    byKey.delete(entry.key);
    entry.settle(null);
}

function join(entry: Entry, signal?: AbortSignal): Promise<string | null> {
    entry.waiters++;
    if (!signal) return entry.result;
    return new Promise((resolve) => {
        const onAbort = () => {
            entry.waiters--;
            if (entry.waiters <= 0 && !entry.started) cancel(entry);
            resolve(null);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void entry.result.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        });
    });
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ done: false }), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve({ done: true, value });
            },
            () => {
                clearTimeout(timer);
                resolve({ done: true, value: null as T });
            },
        );
    });
}

type TaskEngine = {
    ready(): Promise<LocalAiEngineId>;
    generate(prompt: string, options: GenerateOptions): Promise<string | null>;
};

const ladderEngine: TaskEngine = {
    ready: () => initLocalAiLadder({ waitMs: ENGINE_WAIT_MS }),
    generate: generateWithActiveEngine,
};

let engine: TaskEngine = ladderEngine;

async function runEntry(entry: Entry): Promise<void> {
    const id = await engine.ready();
    if (id === "heuristic" || (entry.engines && !entry.engines.includes(id))) {
        entry.settle(null);
        return;
    }
    const generation = engine.generate(entry.prompt, entry.options);
    const first = await settleWithin(generation, entry.timeoutMs);
    entry.settle(first.done ? first.value : null);
    if (!first.done) await settleWithin(generation, STUCK_RELEASE_MS);
}

async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
        while (queue.length > 0) {
            const entry = queue.shift()!;
            entry.started = true;
            try {
                await runEntry(entry);
            } catch (error) {
                console.warn("[local-ai] task failed", error);
                entry.settle(null);
            } finally {
                byKey.delete(entry.key);
            }
        }
    } finally {
        draining = false;
    }
}

export function runLocalAiTask(task: LocalAiTask): Promise<string | null> {
    if (!localAiTaskReady() || task.signal?.aborted) return Promise.resolve(null);

    const existing = byKey.get(task.key);
    if (existing) {
        if ((task.priority ?? "visible") === "visible") promote(existing);
        return join(existing, task.signal);
    }

    let settle!: (value: string | null) => void;
    let settled = false;
    const result = new Promise<string | null>((resolve) => {
        settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
    });
    const entry: Entry = {
        key: task.key,
        prompt: task.prompt,
        options: { temperature: task.temperature, maxTokens: task.maxTokens },
        engines: task.engines,
        timeoutMs: task.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        priority: task.priority ?? "visible",
        waiters: 0,
        started: false,
        settle,
        result,
    };
    byKey.set(entry.key, entry);
    enqueue(entry);
    const joined = join(entry, task.signal);
    void drain();
    return joined;
}

/** Test helper — drops queued work (running work finishes on its own) and
 *  swaps the engine (null restores the real ladder). */
export function resetLocalAiTasksForTests(fake: TaskEngine | null = null): void {
    for (const entry of queue.splice(0)) entry.settle(null);
    byKey.clear();
    engine = fake ?? ladderEngine;
}

/**
 * Apply-return capture (Zeigarnik Effect / "closing an open loop") —
 * `handleOpenPosting`/`openPostingNow` (jobs/page.tsx AND
 * PublicJobDetail.tsx — every surface that sends a signed-in visitor to the
 * employer's site) arms a pending record; today "did you apply?" is 100%
 * user-remembered (the ledger only learns about it if they come back and
 * press "Mark as applied" themselves). This module is the pure decision +
 * record/storage plumbing behind the tab-return prompt — no React, no DOM
 * global reference, so it's unit-testable with a plain in-memory storage
 * stub. `src/components/jobs/ApplyReturnPrompt.tsx` is the one React hook
 * built on top of it; both mounts (board + standalone) share that hook
 * rather than each re-implementing arming/detection/one-shot bookkeeping.
 */

/**
 * Below this, a tab switch reads as a glance (comparing tabs, a distraction),
 * not a genuine trip to the employer's application form.
 */
export const APPLY_RETURN_THRESHOLD_MS = 10_000;

export interface ShouldPromptApplyReturnInput {
    /** Milliseconds since the visitor was sent away. */
    awayMs: number;
    /** This job is already marked applied (any source) — asking again would
     *  be noise, not a closed loop. */
    alreadyApplied: boolean;
    /** This exact job already triggered the prompt once this session — one
     *  prompt max per job per session (brief). */
    alreadyPrompted: boolean;
}

export function shouldPromptApplyReturn(input: ShouldPromptApplyReturnInput): boolean {
    if (input.alreadyApplied || input.alreadyPrompted) return false;
    return input.awayMs >= APPLY_RETURN_THRESHOLD_MS;
}

/** One pending "did you apply?" slot — see `ApplyReturnPrompt.tsx`'s
 *  `ApplyReturnJob` for the (wider) shape a caller hands back to
 *  `doMarkApplied` once this resolves. */
export interface ApplyReturnRecord {
    jobId: string;
    title: string;
    company: string | null;
    /** `Date.now()` when the visitor left for the employer's site. */
    leftAt: number;
    /** This record already surfaced the prompt once — see
     *  `shouldPromptApplyReturn`'s `alreadyPrompted`. */
    prompted: boolean;
    /** The employer posting the visitor left for, so "Yes" can save it on
     *  the tracked role. Optional: records armed before it existed lack it. */
    applyUrl?: string;
}

/** Storage the record lives in — `Pick<Storage, ...>` rather than the full
 *  DOM `Storage` interface so a test can pass a minimal in-memory stub
 *  instead of a real `sessionStorage`/jsdom. */
export type ApplyReturnStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One slot, latest wins — a second `arm()` (a new job) replaces whatever
 *  was pending for the first, same as the original in-memory ref this
 *  replaces (`awayForApplyRef`) only ever held one job at a time. */
export const APPLY_RETURN_STORAGE_KEY = "velai.applyReturn";

function isApplyReturnRecord(value: unknown): value is ApplyReturnRecord {
    if (typeof value !== "object" || value === null) return false;
    const r = value as Record<string, unknown>;
    return (
        typeof r.jobId === "string" &&
        typeof r.title === "string" &&
        (typeof r.company === "string" || r.company === null) &&
        typeof r.leftAt === "number" &&
        typeof r.prompted === "boolean" &&
        (r.applyUrl === undefined || typeof r.applyUrl === "string")
    );
}

/** Reads the pending record, or `null` for "nothing pending" — including a
 *  missing key, a corrupt value, or a storage read that throws (Safari
 *  private mode, quota errors). A storage failure is never a reason to
 *  crash the apply flow. */
export function readApplyReturnRecord(storage: ApplyReturnStorage): ApplyReturnRecord | null {
    try {
        const raw = storage.getItem(APPLY_RETURN_STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isApplyReturnRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function writeApplyReturnRecord(storage: ApplyReturnStorage, record: ApplyReturnRecord | null): void {
    try {
        if (record === null) {
            storage.removeItem(APPLY_RETURN_STORAGE_KEY);
        } else {
            storage.setItem(APPLY_RETURN_STORAGE_KEY, JSON.stringify(record));
        }
    } catch {
        // Best-effort persistence — losing the prompt is a lesser failure
        // than throwing out of the click handler that sent the visitor away.
    }
}

/** Arms the pending slot for a freshly-departed job — call from the same
 *  click handler that opens the posting. */
export function armApplyReturn(
    storage: ApplyReturnStorage,
    job: { jobId: string; title: string; company: string | null; applyUrl?: string | null },
    leftAt: number,
): void {
    writeApplyReturnRecord(storage, {
        jobId: job.jobId,
        title: job.title,
        company: job.company,
        leftAt,
        prompted: false,
        ...(job.applyUrl ? { applyUrl: job.applyUrl } : {}),
    });
}

/** Clears the pending slot — call once the prompt is resolved (applied or
 *  dismissed) so a reload doesn't resurface it. */
export function clearApplyReturn(storage: ApplyReturnStorage): void {
    writeApplyReturnRecord(storage, null);
}

/**
 * The full "did the visitor just return from applying?" check: reads the
 * pending record, decides via `shouldPromptApplyReturn`, and — only when it
 * says yes — marks the record `prompted` (persisted) before handing it
 * back. Calling this twice in a row for the same return (e.g. `focus` firing
 * right after `visibilitychange`) is safe by construction: the second call
 * sees `prompted: true` and returns `null`, so a caller needs no debounce of
 * its own.
 */
export function evaluateApplyReturn(
    storage: ApplyReturnStorage,
    now: number,
    isAlreadyApplied: (jobId: string) => boolean,
): ApplyReturnRecord | null {
    const record = readApplyReturnRecord(storage);
    if (!record || record.prompted) return null;
    const alreadyApplied = isAlreadyApplied(record.jobId);
    if (
        !shouldPromptApplyReturn({
            awayMs: now - record.leftAt,
            alreadyApplied,
            alreadyPrompted: record.prompted,
        })
    ) {
        return null;
    }
    const prompted: ApplyReturnRecord = { ...record, prompted: true };
    writeApplyReturnRecord(storage, prompted);
    return prompted;
}

/**
 * Where the panel remembers which proposed résumé changes a person accepted or
 * rejected for a job (chrome.storage.local), so the card's "Fill from your
 * résumé" attaches the same résumé the panel shows. Marks only, no résumé text
 * (tailor-review.ts), pruned to the most recent 40 jobs and 60 days.
 */
import { choiceOf, pruneChoices, type Decision, type StoredChoice } from "./tailor-review";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";

/** chrome.storage.local key: per job (`choiceKey`), what the person accepted and rejected. */
export const TAILOR_CHOICES_KEY = "velaiTailorChoices";

type All = Record<string, StoredChoice>;

async function readAll(): Promise<All> {
    try {
        const stored = await chrome.storage.local.get(TAILOR_CHOICES_KEY);
        return (stored[TAILOR_CHOICES_KEY] as All | undefined) ?? {};
    } catch {
        return {};
    }
}

export async function loadChoice(key: string | null): Promise<StoredChoice | null> {
    if (!key) return null;
    return (await readAll())[key] ?? null;
}

/** Writes wait for the last, so two quick clicks don't drop each other's. */
let writes: Promise<void> = Promise.resolve();

export function saveChoice(key: string | null, draft: TailorDraft, decisions: ReadonlyMap<string, Decision>, resumeAt: string | null): Promise<void> {
    if (!key) return Promise.resolve();
    const write = async () => {
        const now = Date.now();
        const all = await readAll();
        all[key] = choiceOf(draft, decisions, resumeAt, now);
        try {
            await chrome.storage.local.set({ [TAILOR_CHOICES_KEY]: pruneChoices(all, now) });
        } catch {
            // Not remembered: the panel still shows what was decided until it closes.
        }
    };
    writes = writes.then(write, write);
    return writes;
}

/**
 * The pure half of résumé tailoring: the truthfulness gate every accepted
 * draft passes (`groundDraft`) and the job → tailor-input adapter. Split out
 * of tailor-with-engine.ts so a caller that only runs the heuristic tailor
 * (the Velai Chrome extension) can use them without bundling the on-device
 * model ladder. tailor-with-engine.ts re-exports both, so its callers are
 * unchanged.
 */
import { locationText } from "@/lib/jobs/presentation";
import { introducesNewNumbers, type TailorBulletDiff, type TailorDraft, type TailorJobInput } from "./tailor-resume";
import type { ResumeData } from "@/types/resume";

const GROUNDED_WORD_MIN_LENGTH = 4;
const GROUNDED_WORD_RE = new RegExp(`[a-z]{${GROUNDED_WORD_MIN_LENGTH},}`, "g");

/** Raw (unfiltered) word membership for `resumeText` — deliberately not the
 *  stopword-filtered `resumeVocabulary` used for JD-overlap scoring in
 *  tailor-resume.ts: ordinary words like "team" or "company" are fine for a
 *  rewrite to reuse, only words absent from the résumé altogether are
 *  invented claims. */
function resumeWordSet(resumeText: string): Set<string> {
    return new Set(resumeText.toLowerCase().match(GROUNDED_WORD_RE) ?? []);
}

/** True when `text` contains a word of `GROUNDED_WORD_MIN_LENGTH`+ letters
 *  that never appears anywhere in the résumé's own text. */
function introducesUngroundedWord(vocabulary: Set<string>, text: string): boolean {
    const words = text.toLowerCase().match(GROUNDED_WORD_RE) ?? [];
    return words.some((w) => !vocabulary.has(w));
}

function isGrounded(vocabulary: Set<string>, before: string, after: string): boolean {
    return !introducesNewNumbers(before, after) && !introducesUngroundedWord(vocabulary, after);
}

function revertBulletInResume(resume: ResumeData, bullet: TailorBulletDiff): ResumeData {
    const list = bullet.source === "project" ? resume.projects : resume.experience;
    if (!list) return resume;
    const idx = list.findIndex((e) => e.id === bullet.experienceId);
    if (idx < 0) return resume;
    list[idx] = {
        ...list[idx],
        description: list[idx].description.replace(bullet.after, bullet.before),
    };
    return resume;
}

/**
 * The tailor's truthfulness gate (front-door C1) — applied to every accepted
 * draft, heuristic or model, at draft-acceptance time. Drops any bullet or
 * summary edit that (a) introduces a number absent from its original, or (b)
 * introduces a word of `GROUNDED_WORD_MIN_LENGTH`+ letters absent from the
 * résumé's own text (an unconditional class guard — it runs on every draft,
 * not just the one that surfaced the bug). A dropped bullet is reverted to
 * its original text in `tailored`, not merely excluded from the diff list,
 * so the returned résumé never carries an ungrounded claim.
 */
export function groundDraft(resumeText: string, draft: TailorDraft): TailorDraft {
    const vocabulary = resumeWordSet(resumeText);

    let tailored = draft.tailored;
    const bullets = draft.bullets.filter((b) => {
        if (isGrounded(vocabulary, b.before, b.after)) return true;
        tailored = revertBulletInResume(tailored, b);
        return false;
    });

    const summaryGrounded = isGrounded(vocabulary, draft.summaryBefore, draft.summaryAfter);
    const summaryAfter = summaryGrounded ? draft.summaryAfter : draft.summaryBefore;
    tailored.generatedSummary = summaryAfter;

    return { ...draft, tailored, bullets, summaryAfter };
}

/** PublicJob → TailorJobInput adapter for UI callers. */
export function jobToTailorInput(job: {
    title: string;
    company?: string | null;
    tags?: string[] | null;
    description?: string | null;
    occupation?: string | null;
    location?: string | null;
    location_city?: string | null;
    location_state?: string | null;
    location_country?: string | string[] | null;
    work_type?: string | null;
}): TailorJobInput {
    const place = locationText(job as Parameters<typeof locationText>[0]);
    const location =
        place && place !== "Location not listed" ? place : (job.location?.trim() || null);
    return {
        title: job.title,
        company: job.company,
        tags: job.tags,
        description: job.description,
        occupation: job.occupation,
        location,
    };
}

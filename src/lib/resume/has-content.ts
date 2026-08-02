/**
 * Whether a résumé has any real content yet — the one place this is decided.
 * `ResumeBuilder.tsx`'s load-priority chain reads it to know whether
 * DB/localStorage data counts as "loaded"; its header reads it to decide
 * whether to show the "nothing here yet" empty-state hint. No React, no I/O
 * — unit-testable in isolation.
 */

import type { ResumeData } from "@/types/resume";

export function hasResumeContent(d: ResumeData): boolean {
    return !!(d.profile?.profession || d.experience?.length || d.generatedSummary);
}

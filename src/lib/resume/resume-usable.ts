import type { ResumeData } from "@/types/resume";

/**
 * A résumé is "usable" for matching if it has a profession or at least one
 * skill. Single source of truth: /jobs (`page.tsx`) reads it client-side off
 * local `resume` state, and the `hasUsableResumeOnFile` server action
 * (`actions/resume.ts`) reads it server-side off the persisted document — both
 * must agree on the exact same bar, so this lives in one place both can
 * import instead of two copies drifting apart.
 */
export function resumeIsUsable(d: ResumeData | undefined): boolean {
    if (!d) return false;
    if ((d.profile?.profession ?? "").trim()) return true;
    return (d.competencies ?? []).some((c) => (c.skills ?? []).some((s) => (s ?? "").trim()));
}

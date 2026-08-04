"use server";

import { getBaseResumeSummaryForUser, type BaseResume } from "@/lib/resume/base-resume";
import { getServerUser } from "@/lib/firebase/auth-session";

export type ResumeSummary = BaseResume & { updatedAt: string | null };

// Same "no direct unit test" boundary as agent-preferences.ts's actions —
// `getServerUser()` throws outside a real request scope, so the
// unauthenticated branch isn't exercisable in a plain unit test. The
// canonicalization logic this delegates to is covered by
// tests/unit/resume-base-resume.test.ts.
export async function fetchResumeSummaryAction(): Promise<{ data?: ResumeSummary; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    return { data: await getBaseResumeSummaryForUser(user.uid) };
}

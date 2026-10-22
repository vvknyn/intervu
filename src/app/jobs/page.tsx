import { redirect } from "next/navigation";
import { fetchAgentPreferencesAction } from "@/actions/agent-preferences";
import { fetchResumeData } from "@/actions/resume";
import JobsRouteGate from "@/app/jobs/JobsRouteGate";
import { getServerUser } from "@/lib/auth/server-user";
import { ENTRY_BUDGET_MS, fitEntryPath, resolveJobsEntry, withinBudget } from "@/lib/jobs/server-entry";
import { resumeIsOnFile, resumeIsUsable } from "@/lib/resume/resume-usable";

/**
 * Server entry — the server decides a signed-in visitor's first frame
 * (server-entry.ts): their résumé-ranked search is a redirect away, or the
 * page renders with the session and résumé presence already settled. A
 * signed-out visitor, and a signed-in one whose reads miss the budget, get the
 * page as before (the client asks the server who is signed in).
 */
export default async function JobsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const user = await getServerUser();
    if (!user) return <JobsRouteGate />;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
        for (const one of [value].flat()) if (one != null) search.append(key, one);
    }
    const reads = await withinBudget(Promise.all([fetchResumeData(), fetchAgentPreferencesAction()]), ENTRY_BUDGET_MS);
    const [stored, prefs] = reads ?? [null, null];
    const entry = resolveJobsEntry({
        user,
        search,
        // A failed read is not "no résumé": only a read that answered says so.
        resumeOnFile: stored && !stored.error ? resumeIsOnFile(stored) : null,
        // The fit address needs the stated preferences too; without them the client builds it, as before.
        resume: stored && !stored.error ? { data: stored.data, text: stored.text, updatedAt: stored.updatedAt } : null,
        fitPath: stored?.data && resumeIsUsable(stored.data) && prefs?.data ? fitEntryPath(stored.data, prefs.data) : null,
    });
    if (entry.kind === "redirect") redirect(entry.url);
    return <JobsRouteGate initial={entry.initial} />;
}

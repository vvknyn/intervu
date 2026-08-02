"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, Buildings, CalendarBlank } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "@/lib/toast";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { updateApplication } from "@/actions/application";
import { searchJobsAction } from "@/actions/jobs";
import { classifyExistenceCheck } from "@/lib/jobs/result-state";
import { JobDetail } from "@/components/jobs/JobDetail";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import type { PublicJob } from "@/lib/jobs/types";
import { updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import {
    hasReachedStage,
    nextAction,
    orderResumeVersionsLatestFirst,
    stageLabel,
    type Pursuit,
    type ResumeVersionSnapshot,
} from "@/lib/pursuits/types";

/** Downloads a resume-version snapshot as a `.md` file, client-side, from
 *  its stored text — no PDF, no new deps, same Blob-download shape as
 *  `lib/export-utils.ts`'s `exportStoriesToText`. */
function downloadResumeVersion(version: ResumeVersionSnapshot): void {
    const blob = new Blob([version.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${version.label.replace(/[^\w.-]+/g, "-")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/** Resume used row (spec: "label, saved date (mono), Download button") —
 *  degrades by omission to a plain sentence when no resume was ever filed
 *  against this pursuit (e.g. a quick "mark applied" outside the wizard),
 *  rather than fabricating a version. Lists every version, latest first, so
 *  re-filing a resume never hides earlier ones. */
function ResumeUsedCard({ pursuit }: { pursuit: Pursuit }) {
    const versions = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? []);
    return (
        <div className="border border-border bg-card p-6">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Resume used</div>
            {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resume version on file for this application.</p>
            ) : (
                <div className="divide-y divide-border">
                    {versions.map((version, i) => (
                        <div key={`${version.saved_at}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">{version.label}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                    {new Date(version.saved_at).toLocaleDateString(undefined, {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                    })}
                                </p>
                            </div>
                            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => downloadResumeVersion(version)}>
                                Download
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * The pursuit page: one header, ONE next-action block per `nextAction()`
 * (spec §3 "stage choreography" — never three tool offers at once, never a
 * disabled button). Reuses `updateApplication` for signed-in mutations and
 * `updateGuestPursuit` for a guest's local record — same route either way,
 * since `usePursuits()` already serves both from one list.
 */
export default function PursuitDetailPage() {
    const params = useParams<{ id: string }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const { pursuits, loading } = usePursuits();
    const [interviewDate, setInterviewDate] = useState("");
    const [saving, setSaving] = useState(false);
    // One clock read for this page's whole lifetime. JobDetail derives relative
    // ages from it during render, where a fresh Date.now() would be the
    // impure-render call react-hooks/purity flags.
    const [nowMs] = useState(() => Date.now());
    /**
     * Three outcomes, deliberately kept apart: we have the live posting, we
     * know it's gone, or we couldn't find out.
     *
     * The third is not hypothetical. Looking a posting up by id needs `id` in
     * the index's `filterableAttributes` — index state, not repo state. That
     * setting went live 2026-07-25 (verified: `id = "<doc>"` resolves), but it
     * was absent for the six days before, during which this lookup failed
     * outright, and a future re-provision can drop it again with no deploy.
     * Collapsing "couldn't check" into "no longer live" would tell people a
     * role they can still apply to is dead. `classifyExistenceCheck` is the
     * existing chokepoint for exactly this call, and it degrades to "unknown".
     */
    const [detail, setDetail] = useState<{
        open: boolean;
        job: PublicJob | null;
        state: "idle" | "loading" | "gone" | "unknown";
    }>({ open: false, job: null, state: "idle" });

    const pursuit = pursuits.find((p) => p.id === id);

    /**
     * Open the live posting behind this pursuit. Only reachable when `job_id`
     * exists — a manually-added pursuit has no posting to show, so its card
     * stays inert rather than opening a sheet that can only apologise.
     * Fetched once and kept; reopening doesn't re-query.
     */
    const openDetail = async (jobId: string) => {
        if (detail.job) return setDetail((d) => ({ ...d, open: true }));
        setDetail({ open: true, job: null, state: "loading" });
        const res = await searchJobsAction({ id: jobId, limit: 1, offset: 0, hideGhosts: false });
        const check = classifyExistenceCheck(jobId, res);
        setDetail({
            open: true,
            job: check.status === "found" ? check.job : null,
            state: check.status === "found" ? "idle" : check.status === "not_found" ? "gone" : "unknown",
        });
    };

    const mutate = async (patch: Partial<Pursuit>) => {
        setSaving(true);
        try {
            if (getCurrentUser()) {
                const res = await updateApplication(id, patch);
                if (res.error) {
                    toast.error(`Could not save: ${res.error}`);
                    return;
                }
                invalidatePursuitsCache();
            } else {
                const updated = updateGuestPursuit(id, patch);
                if (!updated) toast.error("Could not find this pursuit.");
            }
        } finally {
            setSaving(false);
        }
    };

    const backLink = (
        <Link href="/yours" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Yours
        </Link>
    );

    if (loading) {
        return (
            <PageLayout header={<PageHeader title="Yours" actions={backLink} />}>
                <div className="h-40 animate-pulse rounded-xl bg-card" />
            </PageLayout>
        );
    }

    if (!pursuit) {
        return (
            <PageLayout header={<PageHeader title="Yours" actions={backLink} />}>
                <div data-testid="pursuit-not-found" className="py-24 text-center text-sm text-muted-foreground">
                    We couldn&apos;t find that pursuit.
                </div>
            </PageLayout>
        );
    }

    const action = nextAction(pursuit);
    const snapshot = pursuit.job_snapshot;

    const identity = (
        <>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Buildings size={26} />
            </div>
            <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold tracking-tight">{pursuit.company_name}</h1>
                <p className="text-muted-foreground">{pursuit.position}</p>
                {snapshot?.location && <p className="mt-1 text-xs text-muted-foreground">{snapshot.location}</p>}
            </div>
        </>
    );

    return (
        <PageLayout header={<PageHeader title={pursuit.company_name} description={pursuit.position} actions={backLink} />}>
            <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-6">
                    {/* Clickable only when a live posting is actually linked. A
                        manual pursuit has no `job_id`, so it renders as plain
                        text — offering a click that could only open an apology
                        is worse than not offering one. */}
                    {pursuit.job_id ? (
                        <button
                            type="button"
                            onClick={() => void openDetail(pursuit.job_id!)}
                            className="flex w-full items-start gap-4 text-left transition-opacity hover:opacity-80"
                            aria-label={`View the posting for ${pursuit.position} at ${pursuit.company_name}`}
                        >
                            {identity}
                        </button>
                    ) : (
                        <div className="flex items-start gap-4">{identity}</div>
                    )}
                    <div data-testid="pursuit-stage" className="mt-4 text-sm text-muted-foreground">
                        {stageLabel(pursuit)}
                    </div>
                    {/* Honest about a dead listing (spec §7): the snapshot carries the
                        JD, so tailor/prep still work even after the live posting expires
                        out of Meilisearch — but say so plainly rather than pretending
                        nothing happened. */}
                    {!snapshot && pursuit.job_id && (
                        <p className="mt-2 text-xs text-muted-foreground">This listing&apos;s details are no longer available.</p>
                    )}
                </div>

                <ResumeUsedCard pursuit={pursuit} />

                <div className="rounded-xl border border-border bg-card p-6">
                    {/* Tailoring moved to MCP 2026-08-02 — the in-app
                        /resume-tailor link is gone; the quiet handoff note
                        replaces it (same pattern as the "prep" note below). */}
                    {action.kind === "tailor" && <McpHandoffNote />}

                    {action.kind === "apply" && (
                        <div className="flex flex-wrap gap-2">
                            {pursuit.job_url && (
                                <Button
                                    variant="outline"
                                    onClick={() => window.open(pursuit.job_url, "_blank", "noopener,noreferrer")}
                                    className="gap-2"
                                >
                                    <ArrowSquareOut size={16} />
                                    Open posting
                                </Button>
                            )}
                            <Button disabled={saving} onClick={() => mutate({ status: "applied", applied_at: new Date().toISOString() })}>
                                {saving ? "Saving…" : "I applied"}
                            </Button>
                        </div>
                    )}

                    {action.kind === "set_interview" && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                type="date"
                                value={interviewDate}
                                onChange={(e) => setInterviewDate(e.target.value)}
                                className="w-auto"
                                aria-label="Interview date"
                            />
                            <Button
                                disabled={saving || !interviewDate}
                                onClick={() =>
                                    mutate({ status: "interviewing", interview_date: new Date(interviewDate).toISOString() })
                                }
                                className="gap-2"
                            >
                                <CalendarBlank size={16} />
                                {saving ? "Saving…" : "Set interview date"}
                            </Button>
                        </div>
                    )}

                    {/* Prep surface removed 2026-08-02 — no more link into a
                        prep tool for the "interviewing" stage's next action;
                        a quiet note instead (spec: no link, no new feature). */}
                    {action.kind === "prep" && (
                        <div className="rounded-none border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                            Interviewing? Ask your AI to prep you with this job&apos;s context.
                        </div>
                    )}

                    {action.kind === "closed" && <p className="text-sm text-muted-foreground">{action.label}</p>}
                </div>

                {snapshot?.description && (
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="mb-2 text-[13px] font-semibold">About this role</div>
                        <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground">
                            {snapshot.description}
                        </p>
                    </div>
                )}
            </div>

            <Sheet open={detail.open} onOpenChange={(open) => setDetail((d) => ({ ...d, open }))}>
                <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto custom-scrollbar rounded-t-2xl p-0">
                    <SheetTitle className="sr-only">
                        {pursuit.position} at {pursuit.company_name}
                    </SheetTitle>
                    {detail.state === "loading" ? (
                        <div className="p-6 text-sm text-muted-foreground">Loading this posting…</div>
                    ) : detail.job ? (
                        <JobDetail
                            job={detail.job}
                            now={nowMs}
                            /* Passing the pursuit is what makes JobDetail render its
                               "In Yours ✓" state instead of a "Go after this job" CTA
                               — you are already here because you went after it. */
                            pursuit={pursuit}
                            goingAfter={false}
                            onGoAfter={() => {}}
                            onOpenPosting={() => {
                                const href = pursuit.job_url ?? detail.job?.apply_url;
                                if (href) window.open(href, "_blank", "noopener,noreferrer");
                            }}
                            onMarkApplied={() => void mutate({ status: "applied", applied_at: new Date().toISOString() })}
                            applied={hasReachedStage(pursuit, "applied")}
                            applying={saving}
                        />
                    ) : detail.state === "gone" ? (
                        /* Says what actually happened. The pursuit's own saved
                           snapshot is still on the page behind this sheet, so
                           tailoring still works — but we don't dress a stale
                           snapshot up as the live posting. */
                        <div className="p-6">
                            <p className="text-sm text-foreground">This posting is no longer live.</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                It has left our index since you saved it. What you saved is still on this page.
                            </p>
                        </div>
                    ) : (
                        /* "unknown" — we could not check, so we claim nothing
                           about the role either way. Saying "no longer live"
                           here would declare a job dead on the strength of a
                           failed request. */
                        <div className="p-6">
                            <p className="text-sm text-foreground">We can&apos;t load the live posting right now.</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                What you saved is still on this page, and the posting may well still be open —
                                {pursuit.job_url ? " open it at the source to check." : " we just can't confirm it from here."}
                            </p>
                            {pursuit.job_url && (
                                <button
                                    type="button"
                                    onClick={() => window.open(pursuit.job_url, "_blank", "noopener,noreferrer")}
                                    className="mt-3 text-sm text-brand underline underline-offset-2"
                                >
                                    Open posting
                                </button>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </PageLayout>
    );
}

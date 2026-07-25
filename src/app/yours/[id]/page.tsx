"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, Buildings, CalendarBlank, Lightning } from "@phosphor-icons/react";
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
import type { PublicJob } from "@/lib/jobs/types";
import { updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import { hasReachedStage, nextAction, stageLabel, type Pursuit } from "@/lib/pursuits/types";

/**
 * The pursuit page: one header, ONE next-action block per `nextAction()`
 * (spec §3 "stage choreography" — never three tool offers at once, never a
 * disabled button). Reuses `updateApplication` for signed-in mutations and
 * `updateGuestPursuit` for a guest's local record — same route either way,
 * since `usePursuits()` already serves both from one list.
 */
export default function PursuitDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
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

    // `?pursuit=` rather than company+position: those two strings name the role
    // but carry no posting text, so the tailor page could never analyse
    // anything from them and had to ask the user for what this record already
    // knows. The id lets it resolve the posting and run on arrival.
    const tailorHref = `/resume-tailor?pursuit=${encodeURIComponent(pursuit.id)}`;

    /* `round` is required for DashboardContainer's URL-restore gate to load into
       a session (see its `urlCompany && urlPosition && urlRound && urlSearched`
       check) — a pursuit doesn't track a round, so this defaults it the same way
       the job-detail "Prep for this" entry point does (src/app/page.tsx
       `handlePrep`). `pursuitId` is jobs-first-bloom PR3 §3 stage wiring: it's
       what lets DashboardContainer mirror this session durably onto the pursuit
       and stamp `last_prepped_at`. One const because the stage button and the
       detail sheet must send you to the same place. */
    const prepHref = `/prep?company=${encodeURIComponent(pursuit.company_name)}&position=${encodeURIComponent(pursuit.position)}&round=Technical&searched=true&pursuitId=${encodeURIComponent(pursuit.id)}`;

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

                <div className="rounded-xl border border-border bg-card p-6">
                    {action.kind === "tailor" && (
                        <Button asChild className="gap-2">
                            <Link href={tailorHref}>{action.label}</Link>
                        </Button>
                    )}

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

                    {action.kind === "prep" && (
                        <Button asChild className="gap-2">
                            <Link href={prepHref}>
                                <Lightning size={16} weight="fill" />
                                {action.label}
                            </Link>
                        </Button>
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
                            onTailor={() => router.push(tailorHref)}
                            onOpenPosting={() => {
                                const href = pursuit.job_url ?? detail.job?.apply_url;
                                if (href) window.open(href, "_blank", "noopener,noreferrer");
                            }}
                            onMarkApplied={() => void mutate({ status: "applied", applied_at: new Date().toISOString() })}
                            onPrep={() => router.push(prepHref)}
                            applied={hasReachedStage(pursuit, "applied")}
                            applying={saving}
                        />
                    ) : detail.state === "gone" ? (
                        /* Says what actually happened. The pursuit's own saved
                           snapshot is still on the page behind this sheet, so
                           tailor and prep keep working — but we don't dress a
                           stale snapshot up as the live posting. */
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

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Scales, Warning, X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { assessJobFitAction } from "@/actions/job-fit";
import type { FitAssessment, FitVerdictLabel } from "@/lib/jobs/fit-verdict";
import type { PublicJob } from "@/lib/jobs/types";
import { decodeText, cleanCompany, locationText } from "@/lib/jobs/presentation";
import { cn } from "@/lib/utils";

const VERDICT_LABEL: Record<FitVerdictLabel, string> = {
    strong: "Strong fit",
    stretch: "Stretch fit",
    weak: "Weak fit",
};

const VERDICT_PILL: Record<FitVerdictLabel, string> = {
    strong: "border-[color:var(--elite-tint-border)] bg-[color:var(--elite-tint-bg)] text-[color:var(--elite-brand)]",
    stretch: "border-[#E8D4A8] bg-[#FDF6ED] text-[#9A6B2E]",
    weak: "border-border bg-muted/40 text-muted-foreground",
};

type DrawerPhase = "loading" | "ready" | "needsAuth" | "needsResume" | "error";

export function FitDrawer({
    open,
    onOpenChange,
    job,
    onTailor,
    onPrep,
    onApply,
    onAuthRequired,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    job: PublicJob | null;
    onTailor: () => void;
    onPrep: () => void;
    onApply: () => void;
    onAuthRequired?: () => void;
}) {
    const [phase, setPhase] = useState<DrawerPhase>("loading");
    const [assessment, setAssessment] = useState<FitAssessment | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Monotonic generation guard (same shape as SearchAutocomplete): only the
    // response from the last effect run may update state.
    const assessGenRef = useRef(0);
    // Session cache — reopening the same job must not re-bill (TailorAnalysisSheet pattern).
    const fitCacheRef = useRef(new Map<string, FitAssessment>());

    const jobId = job?.id ?? null;

    // Reset before paint so a new job never briefly shows the prior verdict.
    useLayoutEffect(() => {
        setPhase("loading");
        setAssessment(null);
        setError(null);
    }, [jobId]);

    const runAssessment = useCallback(async (j: PublicJob, myGeneration: number) => {
        try {
            const res = await assessJobFitAction({
                description: j.description ?? "",
                url: j.apply_url || null,
            });
            if (assessGenRef.current !== myGeneration) return;

            if (res.needsAuth) {
                setPhase("needsAuth");
                return;
            }
            if (res.needsResume) {
                setPhase("needsResume");
                return;
            }
            if (res.error) {
                setError(res.error);
                setPhase("error");
                return;
            }
            if (res.data) {
                fitCacheRef.current.set(j.id, res.data);
                setAssessment(res.data);
                setPhase("ready");
            }
        } catch (e) {
            if (assessGenRef.current !== myGeneration) return;
            setError(e instanceof Error ? e.message : "Failed to assess fit");
            setPhase("error");
        }
    }, []);

    useEffect(() => {
        if (!open || !job || !jobId) return;

        const cached = fitCacheRef.current.get(jobId);
        if (cached) {
            setAssessment(cached);
            setPhase("ready");
            setError(null);
            return;
        }

        const myGeneration = assessGenRef.current;
        void runAssessment(job, myGeneration);

        return () => {
            assessGenRef.current += 1;
        };
    }, [open, jobId, job, job?.description, job?.apply_url, runAssessment]);

    const handleRetry = () => {
        if (!job) return;
        if (jobId) fitCacheRef.current.delete(jobId);
        assessGenRef.current += 1;
        const myGeneration = assessGenRef.current;
        setPhase("loading");
        setAssessment(null);
        setError(null);
        void runAssessment(job, myGeneration);
    };

    const showCtas = phase === "ready" || phase === "needsResume";

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="elite-signal flex w-full flex-col overflow-hidden bg-[color:var(--elite-card)] p-0 text-[color:var(--elite-ink)] sm:max-w-[380px]"
                overlayClassName="elite-fit-overlay"
                hideCloseButton
            >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[color:var(--elite-border)] bg-[color:var(--elite-card)] px-5 py-5">
                    <div className="min-w-0 flex-1">
                        <SheetTitle className="font-display text-lg font-semibold leading-snug tracking-tight">
                            {job ? decodeText(job.title) : "Am I a fit?"}
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            Compare this role against your active resume.
                        </SheetDescription>
                        {job && (
                            <p className="mt-1 text-sm font-medium text-[color:var(--elite-brand)]">
                                {cleanCompany(job.company) || "Unknown company"}
                                {locationText(job) ? ` · ${locationText(job)}` : ""}
                            </p>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenChange(false)}
                        className="h-8 w-8 shrink-0 rounded-lg border border-[color:var(--elite-border)] bg-[color:var(--elite-surface)]"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                    {phase === "loading" && (
                        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
                            <div className="relative flex h-12 w-12 items-center justify-center">
                                <div className="absolute inset-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                                <Scales size={18} className="text-brand" weight="fill" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Checking your fit…</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Matching this role against your active resume
                                </p>
                            </div>
                        </div>
                    )}

                    {phase === "needsAuth" && (
                        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 text-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10">
                                <Scales size={22} className="text-brand" />
                            </div>
                            <div className="max-w-xs space-y-2">
                                <p className="text-sm font-semibold">See how you match</p>
                                <p className="text-sm text-muted-foreground">
                                    Sign in to compare this role against your resume — matches, gaps, and next steps.
                                </p>
                            </div>
                            <Button onClick={() => onAuthRequired?.()} className="h-10 px-6">
                                Sign in to continue
                            </Button>
                        </div>
                    )}

                    {phase === "needsResume" && (
                        <div className="space-y-4">
                            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4 text-center">
                                <p className="text-sm font-medium">Add your resume first</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    We need an active resume to assess fit for this role.
                                </p>
                                <Link
                                    href="/resume-builder"
                                    className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
                                >
                                    Build your resume
                                </Link>
                            </div>
                        </div>
                    )}

                    {phase === "error" && (
                        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
                            <Warning size={28} className="text-muted-foreground/60" />
                            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
                            {job && (
                                <Button variant="outline" size="sm" onClick={handleRetry}>
                                    Try again
                                </Button>
                            )}
                        </div>
                    )}

                    {phase === "ready" && assessment && (
                        <div className="space-y-5">
                            <div
                                className={cn(
                                    "inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-sm font-semibold",
                                    VERDICT_PILL[assessment.verdict],
                                )}
                            >
                                {VERDICT_LABEL[assessment.verdict]}
                            </div>

                            {assessment.matches.length > 0 && (
                                <section>
                                    <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--elite-faint)]">
                                        Matches
                                    </h3>
                                    <ul className="mt-2.5 divide-y divide-[color:var(--elite-rule)]">
                                        {assessment.matches.map((item) => (
                                            <li
                                                key={item}
                                                className="flex gap-2.5 py-2 text-[13.5px] leading-snug"
                                            >
                                                <span className="shrink-0 font-semibold text-[color:var(--elite-live)]">✓</span>
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            {assessment.gaps.length > 0 && (
                                <section>
                                    <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--elite-faint)]">
                                        Gaps to address
                                    </h3>
                                    <ul className="mt-2.5 divide-y divide-[color:var(--elite-rule)]">
                                        {assessment.gaps.map((item) => (
                                            <li
                                                key={item}
                                                className="flex gap-2.5 py-2 text-[13.5px] leading-snug"
                                            >
                                                <span className="shrink-0 font-semibold text-[color:var(--elite-faint)]">○</span>
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </div>
                    )}
                </div>

                {showCtas && (
                    <div className="border-t border-[color:var(--elite-border)] bg-[color:var(--elite-surface)] px-5 py-4">
                        <div className="flex flex-col gap-2">
                            <Button
                                variant="outline"
                                className="h-11 w-full border-[1.5px] border-[color:var(--elite-ink)] bg-[color:var(--elite-card)] font-semibold text-[color:var(--elite-ink)] hover:bg-[color:var(--elite-page)]"
                                onClick={onTailor}
                            >
                                Tailor resume
                            </Button>
                            <Button
                                variant="outline"
                                className="h-11 w-full border-[color:var(--elite-tint-border)] font-medium text-[color:var(--elite-brand)] hover:bg-[color:var(--elite-tint-bg)]"
                                onClick={onPrep}
                            >
                                Interview prep
                            </Button>
                            <Button
                                className="h-11 w-full bg-[color:var(--elite-ink)] font-semibold text-[color:var(--elite-surface)] hover:bg-[color:var(--elite-ink)]/90"
                                onClick={onApply}
                            >
                                Apply (tracks automatically)
                            </Button>
                        </div>
                        <p className="mt-3 text-center font-mono text-[11px] text-[color:var(--elite-faint)]">
                            Uses your active resume · 2 credits
                        </p>
                    </div>
                )}

                {phase === "loading" && (
                    <div className="border-t border-[color:var(--elite-border)] bg-[color:var(--elite-surface)] px-5 py-4">
                        <p className="text-center font-mono text-[11px] text-[color:var(--elite-faint)]">
                            Uses your active resume · 2 credits
                        </p>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

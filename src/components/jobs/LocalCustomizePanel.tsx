"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Copy, DownloadSimple, Check, ShieldCheck } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { WaitState } from "@/components/ui/wait-state";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import { applyTailorChanges, roleTermsForJob, startsOn } from "@/lib/local-ai/tailor-resume";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { TailorChangeList } from "@/components/jobs/TailorChangeList";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/pdf-filename";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { CUSTOMIZE_READY_HEADER, SIGN_IN_TO_SYNC_LABEL } from "@/lib/jobs/resume-cta-copy";
import { CUSTOMIZE_RULES_BADGE, CUSTOMIZE_SEALED_BADGE } from "@/lib/privacy-modes";
import { sealedAiStatus } from "@/lib/sealed-ai/client";

export interface LocalCustomizePanelProps {
    job: PublicJob;
    /** Read only: a draft is for this role, so the panel never replaces the résumé it tailors from. */
    resume: ResumeData | null;
    /** Short label for tight bars (mobile document action bar). */
    compactTrigger?: boolean;
    signedIn?: boolean;
    onSignInToSync?: () => void;
}

export function LocalCustomizePanel({
    job,
    resume,
    compactTrigger,
    signedIn = true,
    onSignInToSync,
}: LocalCustomizePanelProps) {
    const [draft, setDraft] = useState<TailorDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [copied, setCopied] = useState(false);
    // Whether this server sends the matched lines to sealed AI: the badge says where they go.
    const [sealed, setSealed] = useState(false);
    // Changes that are off: the ones the person undid and the suggestions they haven't
    // turned on (`startsOn`). Copy and Download use the rest.
    const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
    // How many parts the model is rewriting (lines and the summary, in one request).
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const kept = useMemo(
        () => (draft ? applyTailorChanges(draft.base, draft.changes.filter((c) => !undone.has(c.id))) : null),
        [draft, undone],
    );
    const toggleChange = useCallback((id: string) => {
        setUndone((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleCopy = useCallback(async () => {
        if (!kept) return;
        const md = resumeDataToZipMarkdown(kept);
        await navigator.clipboard.writeText(md);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [kept]);

    const handlePdf = useCallback(() => {
        if (!kept) return;
        const filename = deriveResumePdfFilename({
            company: null,
            role: kept.profile.profession || null,
            fallbackLabel: kept.profile.name || "resume",
            dateIso: new Date().toISOString(),
        });
        void (async () => {
            try {
                // A résumé tailored to this role is one page, keeping what matters for it.
                await exportZipResumePdfFromData(kept, `${filename}.pdf`, {
                    onePage: true,
                    roleTerms: roleTermsForJob(jobToTailorInput(job)),
                });
            } catch {
                toast.error("Failed to generate PDF");
            }
        })();
    }, [kept, job]);

    const visible = !!resume && resumeIsUsable(resume);

    const resetDialogState = useCallback(() => {
        setDraft(null);
        setUndone(new Set());
        setProgress(null);
        setLoading(false);
        setCopied(false);
    }, []);

    const runGenerate = useCallback(async () => {
        if (!resume) return;
        setLoading(true);
        setDraft(null);
        setUndone(new Set());
        setProgress(null);
        try {
            const result = await tailorResumeForJob(resume, jobToTailorInput(job), {
                onProgress: (done, total) => setProgress({ done, total }),
            });
            setDraft(result);
            setUndone(new Set(result.changes.filter((c) => !startsOn(c)).map((c) => c.id)));
        } finally {
            setLoading(false);
            setProgress(null);
        }
    }, [job, resume]);

    // Sealed AI when it's set up, the rules draft otherwise: no step to choose between them.
    const handleOpen = useCallback(() => {
        setDialogOpen(true);
        resetDialogState();
        void sealedAiStatus().then((status) => setSealed(status.enabled));
        void runGenerate();
    }, [resetDialogState, runGenerate]);

    const handleDialogOpenChange = useCallback(
        (open: boolean) => {
            setDialogOpen(open);
            if (!open) resetDialogState();
        },
        [resetDialogState],
    );

    if (!visible || !resume) {
        return null;
    }

    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);

    const engineLabel = draft?.engineLabel ?? null;

    return (
        <>
            <Button
                ref={triggerRef}
                type="button"
                variant="outline"
                size={jobActionSize}
                data-testid="local-customize-open"
                aria-label="Customize for this job"
                disabled={loading && dialogOpen}
                onClick={handleOpen}
                className={cn(
                    "shrink-0",
                    compactTrigger && "px-3",
                    loading && dialogOpen && "opacity-60",
                )}
            >
                {/* One text box: the Button's flex gap would otherwise open a
                    second space before "for this job". */}
                {compactTrigger ? "Customize résumé" : <span>Customize résumé<span className="hidden sm:inline"> for this job</span></span>}
            </Button>

            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogContent
                    className="w-[calc(100%-1rem)] max-w-[720px] gap-0 p-0 sm:max-w-xl"
                    // The dialog opens from our own button, not a DialogTrigger, so Radix has
                    // no trigger to return focus to on close; without this it drops to the page.
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                >
                        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
                            <DialogHeader className="space-y-1 text-left">
                                <div className="flex items-center gap-1.5 text-xs text-brand font-semibold">
                                    <ShieldCheck size={16} className="shrink-0" />
                                    <span data-testid="customize-privacy-badge">{sealed ? CUSTOMIZE_SEALED_BADGE : CUSTOMIZE_RULES_BADGE}</span>
                                </div>
                                <DialogTitle className="break-words text-base font-semibold leading-snug text-foreground">
                                    {CUSTOMIZE_READY_HEADER}
                                </DialogTitle>
                                <p className="text-sm text-muted-foreground">
                                    {job.title}
                                    {companyBrand ? ` · ${companyBrand}` : ""}
                                </p>
                                {!signedIn && onSignInToSync && (
                                    <button
                                        type="button"
                                        onClick={onSignInToSync}
                                        className="text-left text-xs font-semibold text-foreground underline underline-offset-2 transition-colors hover:text-brand"
                                    >
                                        {SIGN_IN_TO_SYNC_LABEL}
                                    </button>
                                )}
                                {engineLabel && (
                                    <p className="text-xs text-muted-foreground">{engineLabel}</p>
                                )}
                            </DialogHeader>
                        </div>

                        <DialogBody
                            data-testid="local-customize-panel"
                            className="px-5 py-4"
                        >
                            {loading && !draft && (
                                <WaitState
                                    label={
                                        progress && progress.total > 0
                                            ? `Rewriting ${progress.total - progress.done} part${progress.total - progress.done === 1 ? "" : "s"} for this posting`
                                            : "Tailoring for this posting"
                                    }
                                />
                            )}

                            {draft && (
                                <div className="space-y-4">
                                    {!draft.usedDescription && (
                                        <p className="text-sm text-muted-foreground">
                                            Tailored from title and tags (posting description not on this hit).
                                        </p>
                                    )}

                                    {kept && <TailorChangeList draft={draft} kept={kept} undone={undone} onToggle={toggleChange} />}
                                </div>
                            )}
                        </DialogBody>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="local-customize-close"
                                onClick={() => handleDialogOpenChange(false)}
                            >
                                Close
                            </Button>
                            {draft && (
                                <>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        data-testid="local-customize-copy"
                                        onClick={() => void handleCopy()}
                                    >
                                        {copied ? <Check size={16} /> : <Copy size={16} />}
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        data-testid="local-customize-pdf"
                                        onClick={handlePdf}
                                    >
                                        <DownloadSimple size={16} />
                                        Download PDF
                                    </Button>
                                </>
                            )}
                        </div>
                </DialogContent>
            </Dialog>

        </>
    );
}

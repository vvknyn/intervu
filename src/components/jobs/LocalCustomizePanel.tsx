"use client";

import { useState, useCallback } from "react";
import { Copy, DownloadSimple, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { readLocalAiEnabled } from "@/lib/local-ai/flag";
import { readLocalAiConsent, grantLocalAiConsent } from "@/lib/local-ai/consent";
import { initLocalAiLadder } from "@/lib/local-ai/ladder";
import { writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { resumeDataToMarkdown } from "@/lib/resume/to-markdown";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { deriveResumePdfFilename, renderResumePdf } from "@/lib/resume/render-pdf";
import { downloadBlob } from "@/lib/export-utils";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";
import { toast, confirmToast } from "@/lib/toast";

export interface LocalCustomizePanelProps {
    job: PublicJob;
    resume: ResumeData | null;
    onAccept?: (data: ResumeData) => void;
}

export function LocalCustomizePanel({ job, resume, onAccept }: LocalCustomizePanelProps) {
    const [draft, setDraft] = useState<TailorDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [consentNeeded, setConsentNeeded] = useState(false);
    const [generatingWithModel, setGeneratingWithModel] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!draft) return;
        const md = resumeDataToMarkdown(draft.tailored);
        await navigator.clipboard.writeText(md);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [draft]);

    const handlePdf = useCallback(() => {
        if (!draft) return;
        const parsed = resumeDataToParsedDocument(draft.tailored);
        const filename = deriveResumePdfFilename({
            company: null,
            role: draft.tailored.profile.profession || null,
            fallbackLabel: draft.tailored.profile.name || "resume",
            dateIso: new Date().toISOString(),
        });
        const pdfBytes = renderResumePdf(parsed);
        downloadBlob(pdfBytes, `${filename}.pdf`, "application/pdf");
    }, [draft]);

    const visible = readLocalAiEnabled() && !!resume && resumeIsUsable(resume);

    const resetSheetState = useCallback(() => {
        setDraft(null);
        setLoading(false);
        setConsentNeeded(false);
        setGeneratingWithModel(false);
        setCopied(false);
    }, []);

    const runGenerate = useCallback(
        async (allowModel: boolean) => {
            if (!resume) return;
            setLoading(true);
            setConsentNeeded(false);
            setGeneratingWithModel(allowModel);
            setDraft(null);
            try {
                const result = await tailorResumeForJob(resume, jobToTailorInput(job), { allowModel });
                setDraft(result);
            } finally {
                setLoading(false);
            }
        },
        [job, resume],
    );

    const handleOpen = useCallback(() => {
        setSheetOpen(true);
        resetSheetState();
        if (readLocalAiConsent()) {
            void runGenerate(true);
        } else {
            setConsentNeeded(true);
        }
    }, [resetSheetState, runGenerate]);

    const handleEnableAi = useCallback(async () => {
        grantLocalAiConsent();
        await initLocalAiLadder();
        void runGenerate(true);
    }, [runGenerate]);

    const handleRulesDraft = useCallback(() => {
        void runGenerate(false);
    }, [runGenerate]);

    const handleSheetOpenChange = useCallback(
        (open: boolean) => {
            setSheetOpen(open);
            if (!open) resetSheetState();
        },
        [resetSheetState],
    );

    const handleAccept = useCallback(async () => {
        if (!draft) return;
        const ok = await confirmToast({
            title: "Update résumé for Rank?",
            description: "This replaces the on-device résumé used to rank jobs on this device.",
            confirmLabel: "Accept",
        });
        if (!ok) return;
        onAccept?.(draft.tailored);
        if (readLocalAiEnabled()) {
            writeLocalAiResume(draft.tailored);
        }
        toast.success("Résumé updated for Rank on this device.");
        setSheetOpen(false);
        resetSheetState();
    }, [draft, onAccept, resetSheetState]);

    if (!visible || !resume) {
        return null;
    }

    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);

    const engineLabel = draft
        ? draft.engineLabel
        : loading
          ? generatingWithModel
              ? "On-device"
              : "Rules draft"
          : consentNeeded
            ? null
            : null;

    return (
        <>
            <button
                type="button"
                data-testid="local-customize-open"
                disabled={loading && sheetOpen}
                onClick={handleOpen}
                className={cn(
                    "shrink-0 text-xs font-semibold text-foreground transition-colors hover:text-brand",
                    loading && sheetOpen && "opacity-60",
                )}
            >
                Customize for this job
            </button>

            <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
                <SheetContent
                    side="bottom"
                    hideCloseButton
                    className="mx-auto max-h-[85dvh] w-full max-w-[720px] overflow-hidden border-border p-0"
                >
                    <div className="flex max-h-[85dvh] min-h-0 flex-col">
                        <div className="shrink-0 border-b border-border">
                            <div className="flex justify-center pb-1 pt-2.5">
                                <span className="h-1 w-9 rounded-none bg-[#d0d6de]" aria-hidden="true" />
                            </div>
                            <div className="flex items-start gap-1 px-5 pb-3.5 pt-1">
                                <SheetHeader className="min-w-0 flex-1 space-y-0.5 text-left">
                                    <SheetTitle className="text-base font-semibold leading-snug text-foreground">
                                        {job.title}
                                        {companyBrand ? ` · ${companyBrand}` : ""}
                                    </SheetTitle>
                                    {engineLabel && (
                                        <p className="text-xs text-muted-foreground">{engineLabel}</p>
                                    )}
                                </SheetHeader>
                                <SheetClose className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground transition-opacity hover:opacity-80">
                                    <span aria-hidden="true">×</span>
                                    <span className="sr-only">Close</span>
                                </SheetClose>
                            </div>
                        </div>

                        <div
                            data-testid="local-customize-panel"
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
                        >
                            {consentNeeded && !loading && !draft && (
                                <div className="space-y-4">
                                    <p className="text-sm text-foreground">
                                        On-device AI can rewrite your summary and bullets for this posting. Nothing
                                        leaves this device until you copy or download.
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Enable downloads a small local model. You can also use a rules-based draft
                                        without enabling.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-9 rounded-none text-xs"
                                            onClick={() => void handleEnableAi()}
                                        >
                                            Enable on-device AI
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-9 rounded-none text-xs"
                                            onClick={handleRulesDraft}
                                        >
                                            Use a rules draft
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {loading && !draft && !consentNeeded && (
                                <p className="text-sm text-muted-foreground">Tailoring on-device…</p>
                            )}

                            {draft && (
                                <div className="space-y-5">
                                    {!draft.usedDescription && (
                                        <p className="text-sm text-muted-foreground">
                                            Tailored from title and tags (posting description not on this hit).
                                        </p>
                                    )}

                                    <div>
                                        <div className="text-sm font-semibold text-foreground">Summary</div>
                                        <p className="mt-2 text-sm leading-relaxed text-foreground">
                                            <span className="font-medium text-muted-foreground">After: </span>
                                            {draft.summaryAfter}
                                        </p>
                                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                            <span className="font-medium">Before: </span>
                                            <span className="line-through">{draft.summaryBefore}</span>
                                        </p>
                                    </div>

                                    {draft.bullets.map((b: TailorDraft["bullets"][number]) => (
                                        <div key={b.experienceId}>
                                            <div className="text-sm font-semibold text-foreground">
                                                {b.role} · {b.company}
                                            </div>
                                            <p className="mt-2 text-sm leading-relaxed text-foreground">
                                                <span className="font-medium text-muted-foreground">After: </span>
                                                {b.after}
                                            </p>
                                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                                <span className="font-medium">Before: </span>
                                                <span className="line-through">{b.before}</span>
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="local-customize-close"
                                className="h-9 rounded-none text-xs"
                                onClick={() => handleSheetOpenChange(false)}
                            >
                                Close
                            </Button>
                            {draft && (
                                <>
                                    <button
                                        type="button"
                                        data-testid="local-customize-copy"
                                        onClick={() => void handleCopy()}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-brand"
                                    >
                                        {copied ? <Check size={14} /> : <Copy size={14} />}
                                        {copied ? "Copied" : "Copy"}
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="local-customize-pdf"
                                        onClick={handlePdf}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-brand"
                                    >
                                        <DownloadSimple size={14} />
                                        Download PDF
                                    </button>
                                    <Button
                                        type="button"
                                        data-testid="local-customize-accept"
                                        variant="outline"
                                        size="sm"
                                        className="ml-auto h-9 rounded-none text-xs"
                                        onClick={() => void handleAccept()}
                                    >
                                        Accept
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}

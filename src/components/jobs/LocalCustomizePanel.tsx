"use client";

import { useState, useCallback, useEffect } from "react";
import { Copy, DownloadSimple, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { readLocalAiEnabled } from "@/lib/local-ai/flag";
import { readLocalAiConsent, grantLocalAiConsent } from "@/lib/local-ai/consent";
import { initLocalAiLadder } from "@/lib/local-ai/ladder";
import { writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { useSilentPacket } from "@/lib/local-ai/use-silent-packet";
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
    /** Short label for tight bars (mobile document action bar). */
    compactTrigger?: boolean;
}

export function LocalCustomizePanel({ job, resume, onAccept, compactTrigger }: LocalCustomizePanelProps) {
    const [draft, setDraft] = useState<TailorDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [consentNeeded, setConsentNeeded] = useState(false);
    const [generatingWithModel, setGeneratingWithModel] = useState(false);

    const { status: packetStatus, cachedDraft, showReviewPacket } = useSilentPacket(job, resume);

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

    const resetDialogState = useCallback(() => {
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

    useEffect(() => {
        if (!dialogOpen || !cachedDraft || draft) return;
        if (loading || packetStatus === "warming" || packetStatus === "ready") {
            setDraft(cachedDraft);
            setLoading(false);
            setConsentNeeded(false);
            setGeneratingWithModel(readLocalAiConsent());
        }
    }, [dialogOpen, cachedDraft, draft, loading, packetStatus]);

    const handleOpen = useCallback(() => {
        setDialogOpen(true);
        setCopied(false);

        if (cachedDraft) {
            setDraft(cachedDraft);
            setLoading(false);
            setConsentNeeded(false);
            setGeneratingWithModel(readLocalAiConsent());
            return;
        }

        if (packetStatus === "warming") {
            setDraft(null);
            setLoading(true);
            setConsentNeeded(false);
            setGeneratingWithModel(readLocalAiConsent());
            return;
        }

        resetDialogState();
        if (readLocalAiConsent()) {
            void runGenerate(true);
        } else {
            setConsentNeeded(true);
        }
    }, [cachedDraft, packetStatus, resetDialogState, runGenerate]);

    const handleEnableAi = useCallback(async () => {
        grantLocalAiConsent();
        await initLocalAiLadder();
        void runGenerate(true);
    }, [runGenerate]);

    const handleRulesDraft = useCallback(() => {
        void runGenerate(false);
    }, [runGenerate]);

    const handleDialogOpenChange = useCallback(
        (open: boolean) => {
            setDialogOpen(open);
            if (!open) resetDialogState();
        },
        [resetDialogState],
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
        setDialogOpen(false);
        resetDialogState();
    }, [draft, onAccept, resetDialogState]);

    if (!visible || !resume) {
        return null;
    }

    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);

    const triggerLabel = showReviewPacket ? "Review packet" : "Customize";
    const triggerAriaLabel = showReviewPacket ? "Review packet" : "Customize for this job";

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
            <Button
                type="button"
                variant="outline"
                data-testid="local-customize-open"
                aria-label={triggerAriaLabel}
                disabled={loading && dialogOpen}
                onClick={handleOpen}
                className={cn(
                    "h-10 shrink-0 rounded-none text-xs font-semibold sm:h-9",
                    compactTrigger && "px-3",
                    loading && dialogOpen && "opacity-60",
                    showReviewPacket && "border-brand text-foreground",
                )}
            >
                {triggerLabel}
                {!showReviewPacket && !compactTrigger && (
                    <span className="hidden sm:inline"> for this job</span>
                )}
            </Button>

            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogContent className="z-[70] flex max-h-[85dvh] w-full max-w-[720px] flex-col overflow-hidden p-0 sm:max-w-xl">
                    <div className="flex min-h-0 max-h-[85dvh] flex-col">
                        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
                            <DialogHeader className="space-y-0.5 text-left">
                                <DialogTitle className="text-base font-semibold leading-snug text-foreground">
                                    {job.title}
                                    {companyBrand ? ` · ${companyBrand}` : ""}
                                </DialogTitle>
                                {engineLabel && (
                                    <p className="text-xs text-muted-foreground">{engineLabel}</p>
                                )}
                            </DialogHeader>
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
                                <div className="space-y-4">
                                    {!draft.usedDescription && (
                                        <p className="text-sm text-muted-foreground">
                                            Tailored from title and tags (posting description not on this hit).
                                        </p>
                                    )}

                                    <Accordion type="multiple" defaultValue={["summary"]}>
                                        <AccordionItem
                                            value="summary"
                                            data-testid="local-customize-section-summary"
                                        >
                                            <AccordionTrigger className="text-sm font-semibold">
                                                Summary
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <p className="text-sm leading-relaxed text-foreground">
                                                    <span className="font-medium text-muted-foreground">After: </span>
                                                    {draft.summaryAfter}
                                                </p>
                                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                                    <span className="font-medium">Before: </span>
                                                    {draft.summaryBefore}
                                                </p>
                                            </AccordionContent>
                                        </AccordionItem>

                                        {draft.bullets.map((b: TailorDraft["bullets"][number]) => (
                                            <AccordionItem
                                                key={b.experienceId}
                                                value={b.experienceId}
                                                data-testid={`local-customize-section-${b.experienceId}`}
                                            >
                                                <AccordionTrigger className="text-sm font-semibold">
                                                    {b.role} · {b.company}
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    <p className="text-sm leading-relaxed text-foreground">
                                                        <span className="font-medium text-muted-foreground">After: </span>
                                                        {b.after}
                                                    </p>
                                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                                        <span className="font-medium">Before: </span>
                                                        {b.before}
                                                    </p>
                                                </AccordionContent>
                                            </AccordionItem>
                                        ))}
                                    </Accordion>
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
                                onClick={() => handleDialogOpenChange(false)}
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
                </DialogContent>
            </Dialog>
        </>
    );
}

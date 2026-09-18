"use client";

import { useState, useCallback } from "react";
import { Copy, DownloadSimple, Check, Cpu, ShieldCheck } from "@phosphor-icons/react";
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
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { formatAuthGateValueLine } from "@/lib/auth/auth-gate-copy";
import { listGuestPursuits } from "@/lib/pursuits/guest-store";
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
    const [authOpen, setAuthOpen] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!getCurrentUser()) {
            setAuthOpen(true);
            return;
        }
        if (!draft) return;
        const md = resumeDataToZipMarkdown(draft.tailored);
        await navigator.clipboard.writeText(md);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [draft]);

    const handlePdf = useCallback(() => {
        if (!getCurrentUser()) {
            setAuthOpen(true);
            return;
        }
        if (!draft) return;
        const filename = deriveResumePdfFilename({
            company: null,
            role: draft.tailored.profile.profession || null,
            fallbackLabel: draft.tailored.profile.name || "resume",
            dateIso: new Date().toISOString(),
        });
        void (async () => {
            try {
                await exportZipResumePdfFromData(draft.tailored, `${filename}.pdf`);
            } catch {
                toast.error("Failed to generate PDF");
            }
        })();
    }, [draft]);

    const visible = !!resume && resumeIsUsable(resume);

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

    const handleOpen = useCallback(() => {
        setDialogOpen(true);
        resetDialogState();
        if (readLocalAiConsent()) {
            void runGenerate(true);
        } else {
            setConsentNeeded(true);
        }
    }, [resetDialogState, runGenerate]);

    const handleEnableAi = useCallback(async () => {
        if (!getCurrentUser()) {
            setAuthOpen(true);
            return;
        }
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
        if (!getCurrentUser()) {
            setAuthOpen(true);
            return;
        }
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
                aria-label="Customize for this job"
                disabled={loading && dialogOpen}
                onClick={handleOpen}
                className={cn(
                    "h-10 shrink-0 rounded-ctl text-xs font-semibold sm:h-9",
                    compactTrigger && "px-3",
                    loading && dialogOpen && "opacity-60",
                )}
            >
                Customize
                {!compactTrigger && <span className="hidden sm:inline"> for this job</span>}
            </Button>

            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogContent className="z-[70] flex max-h-[85dvh] w-[calc(100%-1rem)] max-w-[720px] flex-col overflow-hidden p-0 sm:max-w-xl">
                    <div className="flex min-h-0 max-h-[85dvh] flex-col">
                        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
                            <DialogHeader className="space-y-1 text-left">
                                <div className="flex items-center gap-1.5 text-xs text-brand font-semibold">
                                    <ShieldCheck size={16} />
                                    <span>100% On-Device AI: Private to your browser</span>
                                </div>
                                <DialogTitle className="break-words text-base font-semibold leading-snug text-foreground">
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
                                            className="h-11 min-h-11 rounded-ctl text-xs font-semibold"
                                            onClick={() => void handleEnableAi()}
                                        >
                                            <Cpu size={16} className="mr-1.5" />
                                            Enable on-device AI
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-11 min-h-11 rounded-ctl text-xs font-semibold"
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
                                                    <span className="font-semibold text-muted-foreground">After: </span>
                                                    {draft.summaryAfter}
                                                </p>
                                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                                    <span className="font-semibold">Before: </span>
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
                                                        <span className="font-semibold text-muted-foreground">After: </span>
                                                        {b.after}
                                                    </p>
                                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                                        <span className="font-semibold">Before: </span>
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
                                className="h-11 min-h-11 rounded-ctl text-xs font-semibold"
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
                                        className="h-11 min-h-11 rounded-ctl text-xs font-semibold"
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
                                        className="h-11 min-h-11 rounded-ctl text-xs font-semibold"
                                    >
                                        <DownloadSimple size={16} />
                                        Download PDF
                                    </Button>
                                    <Button
                                        type="button"
                                        data-testid="local-customize-accept"
                                        variant="outline"
                                        size="sm"
                                        className="ml-auto h-11 min-h-11 rounded-ctl text-xs font-semibold"
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

            <AuthPopover
                open={authOpen}
                onOpenChange={setAuthOpen}
                showTrigger={false}
                trigger="auto"
                defaultTab="signup"
                reason="tailor"
                valueLine={formatAuthGateValueLine("tailor", listGuestPursuits().length)}
            />
        </>
    );
}

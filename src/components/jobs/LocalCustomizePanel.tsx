"use client";

import { useState, useCallback } from "react";
import { Copy, DownloadSimple, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { readLocalAiEnabled } from "@/lib/local-ai/flag";
import { readLocalAiConsent } from "@/lib/local-ai/consent";
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

export interface LocalCustomizePanelProps {
    job: PublicJob;
    resume: ResumeData | null;
    onAccept?: (data: ResumeData) => void;
}

export function LocalCustomizePanel({ job, resume, onAccept }: LocalCustomizePanelProps) {
    const [draft, setDraft] = useState<TailorDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

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
    if (!visible || !resume) {
        return null;
    }

    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);

    const handleCustomize = async () => {
        setLoading(true);
        setOpen(true);
        try {
            const allowModel = readLocalAiConsent();
            const result = await tailorResumeForJob(resume, jobToTailorInput(job), { allowModel });
            setDraft(result);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = () => {
        if (!draft) return;
        onAccept?.(draft.tailored);
        if (readLocalAiEnabled()) {
            writeLocalAiResume(draft.tailored);
        }
        setOpen(false);
    };

    return (
        <div className="basis-full w-full min-w-0">
            <button
                type="button"
                data-testid="local-customize-open"
                disabled={loading}
                onClick={() => void handleCustomize()}
                className={cn(
                    "text-xs font-semibold text-foreground transition-colors hover:text-brand",
                    loading && "opacity-60",
                )}
            >
                {loading ? "Customizing…" : "Customize for this job"}
            </button>

            {open && (
                <div
                    data-testid="local-customize-panel"
                    className="mt-3 w-full border-t border-border pt-3"
                >
                    <div className="mb-2 text-xs font-semibold text-foreground">
                        {job.title}
                        {companyBrand ? ` · ${companyBrand}` : ""}
                    </div>
                    {loading && !draft && (
                        <p className="text-xs text-muted-foreground">Tailoring on-device…</p>
                    )}
                    {draft && (
                        <>
                            <p className="mb-2 text-xs text-muted-foreground">
                                Engine: {draft.engineLabel}
                            </p>
                            {!draft.usedDescription && (
                                <p className="mb-2 text-xs text-muted-foreground">
                                    Tailored from title and tags (posting description not on this hit).
                                </p>
                            )}

                            <div className="mb-3 space-y-2">
                                <div className="text-xs">
                                    <div className="font-semibold text-foreground">Summary</div>
                                    <div className="mt-1 text-muted-foreground line-through">{draft.summaryBefore}</div>
                                    <div className="mt-0.5 text-foreground">{draft.summaryAfter}</div>
                                </div>

                                {draft.bullets.map((b: TailorDraft["bullets"][number]) => (
                                    <div key={b.experienceId} className="text-xs">
                                        <div className="font-semibold text-foreground">
                                            {b.role} · {b.company}
                                        </div>
                                        <div className="mt-1 text-muted-foreground line-through">{b.before}</div>
                                        <div className="mt-0.5 text-foreground">{b.after}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
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
                                    className="h-8 rounded-none text-xs"
                                    onClick={handleAccept}
                                >
                                    Accept
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

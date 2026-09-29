"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfidenceIndicator, WarningBanner } from "./ConfidenceIndicator";
import { ResumeReviewFields } from "./ResumeReviewFields";
import { ResumeData, ParsedResumeResult } from "@/types/resume";
import { readLocalAiConsent, grantLocalAiConsent } from "@/lib/local-ai/consent";
import { parseResumeLocally } from "@/lib/local-ai/parse-resume";
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import { RESUME_IMPORT_PARSE_LINE } from "@/lib/jobs/resume-privacy-copy";
import { refuseResumeReview, PROFILE_REVIEW_UNREADABLE_ERROR } from "@/lib/resume/profile-review-parse";
import {
    canAcceptLocalParse,
    LOCAL_PARSE_ACCEPT_MIN,
    scoreLocalParseConfidence,
} from "@/lib/local-ai/parse-confidence";
import { initLocalAiLadder } from "@/lib/local-ai/ladder";
import { FileText, Upload, ClipboardText, ArrowRight, ArrowLeft, Check, Warning, Cpu } from "@phosphor-icons/react";
import { captureEvent } from "@/lib/analytics/events";
import {
    buildResumeFunnelPayload,
    classifyResumeError,
    classifyResumeFileType,
    classifyResumeSizeBucket,
    type ResumeFunnelReason,
} from "@/lib/analytics/resume-funnel";

interface ResumeImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (data: ResumeData, source: 'pdf' | 'docx' | 'text', confidence: number, sourceLabel: string) => void;
    /**
     * Label for the final review-step's confirm button. This modal is
     * shared between the resume-builder (where "Apply to Resume" means
     * "apply these parsed fields to the resume document you're editing" —
     * the default here, keeping that flow byte-identical) and /jobs
     * (src/app/page.tsx), where "Apply to Resume" is confusing
     * builder jargon that also doesn't describe what actually happens next
     * (fit-ranking the job list) — that caller passes "Rank my jobs".
     */
    confirmLabel?: string;
    /**
     * Dialog title override. Defaults to the icon + "Import résumé" — the
     * resume-builder's own mount stays byte-identical. /jobs (ITEM J,
     * 2026-08-15) passes its own: the "best match" sort tab used to summon
     * this modal with zero explanation, so a caller that knows WHY it's
     * opening the importer can now say so.
     */
    title?: string;
    /**
     * Dialog description — required, not defaulted. The old per-step
     * defaults ("100% on-device AI inference" / "On-device AI is
     * analyzing...") overstated what happens when a caller lets the user
     * skip the model download (heuristic-only parsing, no AI runs at all),
     * and both current mounts (/resume, /jobs) already pass their own copy
     * — a default nothing uses is a defect waiting for the next caller.
     */
    description: string;
    /**
     * Second half of the consent paragraph's persistence sentence, after
     * "Your résumé is read on your device, never on our servers." Required,
     * not defaulted, same reasoning as `description`: the modal doesn't
     * know where a caller persists the parsed result (a server action vs.
     * localStorage-only), so it can't state that truthfully on its own —
     * only the caller can. /jobs saves to the signed-in user's account
     * (`saveResumeData`); /resume's `handleImportResume` only writes to
     * this browser (`writeLocalAiResume`), never the server.
     */
    storageNote: string;
    /** Privacy-safe funnel context for résumé analytics. */
    funnelContext?: {
        reason?: ResumeFunnelReason;
        surface?: string;
        signed_in?: boolean;
    };
}

type ImportStep = 'input' | 'parsing' | 'review';
type InputMethod = 'file' | 'paste';

/**
 * The modal's "parsing" step markup, extracted to a standalone export so the
 * design-conformance mock route (src/app/mock/resume) can render this exact
 * state without duplicating it or reaching into the modal's internal step
 * machinery — single source of truth for what "parsing" looks like. Parsing
 * is always on-device now, so this has exactly one rendering — no
 * `localAiEnabled` branch to pick between.
 */
export function ResumeParsingStep() {
    return (
        <div className="py-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-pill bg-surface-2 flex items-center justify-center mx-auto animate-pulse shadow-[var(--shadow-bevel-inset)]">
                <Cpu size={24} weight="fill" className="text-live" />
            </div>
            <div>
                <p className="text-foreground">Parsing your résumé...</p>
                <p className="text-sm text-muted-foreground mt-1">Structuring on this device — no cloud LLM</p>
            </div>
            <div className="w-48 h-1 rounded-pill bg-surface-3 mx-auto overflow-hidden">
                <div className="h-full w-full rounded-pill bg-live animate-pulse" />
            </div>
        </div>
    );
}

export function ResumeImportModal({ isOpen, onClose, onImport, confirmLabel = "Apply to Resume", title, description, storageNote, funnelContext }: ResumeImportModalProps) {
    const [step, setStep] = useState<ImportStep>('input');
    const [inputMethod, setInputMethod] = useState<InputMethod>('file');
    const [pastedText, setPastedText] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [parseResult, setParseResult] = useState<ParsedResumeResult | null>(null);
    const [editedData, setEditedData] = useState<ResumeData | null>(null);
    const [contentType, setContentType] = useState<'pdf' | 'docx' | 'text'>('text');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Founder rule: résumé interpretation never happens on our servers —
    // parsing always runs on-device (see `parseResumeLocally`). These two
    // track the download-consent decision only, not a cloud/local choice.
    const [localAiConsent, setLocalAiConsent] = useState(false);
    const [consentDeclined, setConsentDeclined] = useState(false);
    const [engineLabel, setEngineLabel] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setLocalAiConsent(readLocalAiConsent());
        captureEvent(
            "resume_gate_shown",
            buildResumeFunnelPayload({
                reason: funnelContext?.reason,
                surface: funnelContext?.surface,
                signed_in: funnelContext?.signed_in,
            }),
        );
    }, [isOpen, funnelContext?.reason, funnelContext?.surface, funnelContext?.signed_in]);

    const resetState = () => {
        setStep('input');
        setPastedText("");
        setSelectedFile(null);
        setError(null);
        setParseResult(null);
        setEditedData(null);
        setIsProcessing(false);
        setEngineLabel(null);
        setConsentDeclined(false);
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const extension = file.name.split('.').pop()?.toLowerCase();
            if (extension === 'pdf') {
                setContentType('pdf');
            } else if (extension === 'docx' || extension === 'doc') {
                setContentType('docx');
            } else if (extension === 'txt') {
                setContentType('text');
            } else {
                setError("Unsupported file type. Please use PDF, DOCX, or TXT.");
                captureEvent(
                    "resume_upload_rejected",
                    buildResumeFunnelPayload({
                        source: "picker",
                        error_class: "type",
                        error_code: "type",
                        file_type: classifyResumeFileType(extension),
                        ...funnelContext,
                    }),
                );
                return;
            }
            setSelectedFile(file);
            setError(null);
            captureEvent(
                "resume_upload_selected",
                buildResumeFunnelPayload({
                    source: "picker",
                    file_type: classifyResumeFileType(extension),
                    size_bucket: classifyResumeSizeBucket(file.size),
                    ...funnelContext,
                }),
            );
        }
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
            const extension = file.name.split('.').pop()?.toLowerCase();
            if (extension === 'pdf') {
                setContentType('pdf');
            } else if (extension === 'docx' || extension === 'doc') {
                setContentType('docx');
            } else if (extension === 'txt') {
                setContentType('text');
            } else {
                setError("Unsupported file type. Please use PDF, DOCX, or TXT.");
                captureEvent(
                    "resume_upload_rejected",
                    buildResumeFunnelPayload({
                        source: "drop",
                        error_class: "type",
                        error_code: "type",
                        file_type: classifyResumeFileType(extension),
                        ...funnelContext,
                    }),
                );
                return;
            }
            setSelectedFile(file);
            setError(null);
            captureEvent(
                "resume_upload_selected",
                buildResumeFunnelPayload({
                    source: "drop",
                    file_type: classifyResumeFileType(extension),
                    size_bucket: classifyResumeSizeBucket(file.size),
                    ...funnelContext,
                }),
            );
        }
    }, [funnelContext]);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const processFile = async (file: File): Promise<string> => {
        const extension = file.name.split('.').pop()?.toLowerCase();

        if (extension === 'txt') {
            return await file.text();
        }
        if (extension !== 'pdf' && extension !== 'docx' && extension !== 'doc') {
            throw new Error("Unsupported file type");
        }

        const arrayBuffer = await file.arrayBuffer();
        const isDocx = extension === 'docx' || extension === 'doc';

        // Résumé bytes never leave the browser — unpdf/mammoth run in-page.
        const result = await (isDocx
            ? extractDocxTextInBrowser(arrayBuffer)
            : extractPDFTextInBrowser(arrayBuffer));

        if (result.error) throw new Error(result.error);
        return result.text || "";
    };

    const runParse = async (textContent: string) => {
        const started = Date.now();
        const local = await parseResumeLocally(textContent, { skipDownload: consentDeclined });
        const refusal = refuseResumeReview(local.data.parsed, textContent);
        if (refusal) {
            throw new Error(refusal);
        }
        setEngineLabel(local.engineLabel);
        setParseResult(local.data);
        setEditedData(local.data.parsed);
        setStep('review');
        captureEvent(
            "resume_parse_succeeded",
            buildResumeFunnelPayload({
                duration_ms: Date.now() - started,
                parser_source: consentDeclined ? "rules" : "on_device_model",
                engine: consentDeclined ? "rules" : "on_device_model",
                section_count: local.data.parsed.experience.length + local.data.parsed.education.length,
                warning_count: local.data.warnings?.length ?? 0,
                ...funnelContext,
            }),
        );
    };

    // Implicit grant when Parse is hit before a download decision — one place
    // for the consent-grant sequence.
    const grantConsent = () => {
        grantLocalAiConsent();
        setLocalAiConsent(true);
    };

    const handleSkipDownload = () => {
        setConsentDeclined(true);
    };

    const handleParse = async () => {
        setIsProcessing(true);
        setError(null);
        captureEvent(
            "resume_upload_started",
            buildResumeFunnelPayload({
                source: inputMethod === "paste" ? "paste" : "picker",
                ...funnelContext,
            }),
        );

        try {
            let textContent: string;

            if (inputMethod === 'file' && selectedFile) {
                textContent = await processFile(selectedFile);
            } else if (inputMethod === 'paste' && pastedText.trim()) {
                textContent = pastedText;
                setContentType('text');
            } else {
                throw new Error("No content provided");
            }

            setStep('parsing');
            captureEvent("resume_parse_started", buildResumeFunnelPayload({ ...funnelContext }));

            // Explicitly declining the download means heuristic rules only —
            // never trigger a model download the user asked to skip.
            if (!consentDeclined) {
                if (!localAiConsent) grantConsent();
                await initLocalAiLadder();
            }

            await runParse(textContent);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Failed to parse resume";
            setError(message);
            setStep('input');
            captureEvent(
                "resume_parse_failed",
                buildResumeFunnelPayload({
                    error_class: classifyResumeError({ message }),
                    error_code: classifyResumeError({ message }),
                    ...funnelContext,
                }),
            );
        } finally {
            setIsProcessing(false);
        }
    };

    const reviewConfidence = useMemo(() => {
        if (!editedData) return null;
        return scoreLocalParseConfidence(editedData);
    }, [editedData]);

    const localParseBlocked =
        reviewConfidence !== null && !canAcceptLocalParse(reviewConfidence);

    const handleConfirm = () => {
        if (!editedData || !parseResult) return;
        if (reviewConfidence && !canAcceptLocalParse(reviewConfidence)) {
            captureEvent(
                "resume_upload_rejected",
                buildResumeFunnelPayload({
                    error_class: "too_short",
                    ...funnelContext,
                }),
            );
            return;
        }
        const overall = reviewConfidence?.overall ?? parseResult.confidence.overall;
        const sourceLabel =
            inputMethod === "file" && selectedFile
                ? selectedFile.name
                : "Pasted text";
        captureEvent(
            "resume_review_completed",
            buildResumeFunnelPayload({
                section_count: editedData.experience.length + editedData.education.length,
                warning_count: parseResult.warnings?.length ?? 0,
                ...funnelContext,
            }),
        );
        captureEvent(
            "resume_upload_accepted",
            buildResumeFunnelPayload({
                file_type: classifyResumeFileType(contentType),
                source: inputMethod === "paste" ? "paste" : "picker",
                ...funnelContext,
            }),
        );
        onImport(editedData, contentType, overall, sourceLabel);
        handleClose();
    };

    // Privacy/consent block — explanation + optional basic-parsing link only.
    // The one green parse/download primary lives in the modal footer (no extra
    // first-visit step); footer label is "Download model & parse" until consent
    // is stored or the visitor opts into basic parsing via the link below.
    const renderPrivacyConsent = () => {
        const decided = localAiConsent || consentDeclined;
        return (
            <div className="space-y-2 rounded-panel border border-border bg-surface-2 p-4 shadow-[var(--shadow-bevel-inset)]">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Cpu size={16} className="text-live shrink-0" />
                    <span>Parsed on your device</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    To read your résumé, Velai downloads an AI model to this browser once and runs it here.
                    The download can be large, but it only happens once.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    {RESUME_IMPORT_PARSE_LINE} {storageNote}
                </p>
                {!decided ? (
                    <Button
                        type="button"
                        variant="link"
                        size="link"
                        data-testid="resume-import-skip-download"
                        onClick={handleSkipDownload}
                        className="inline-flex justify-start text-left text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                        Skip the download (basic parsing)
                    </Button>
                ) : null}
            </div>
        );
    };

    const renderInputStep = () => (
        <div className="space-y-6">
            {renderPrivacyConsent()}

            <Tabs
                value={inputMethod}
                onValueChange={(v) => setInputMethod(v as InputMethod)}
                className="gap-4"
            >
                <TabsList className="w-full">
                    <TabsTrigger value="file" className="flex-1">
                        <Upload size={16} weight={inputMethod === "file" ? "fill" : "regular"} />
                        Upload file
                    </TabsTrigger>
                    <TabsTrigger value="paste" className="flex-1">
                        <ClipboardText size={16} weight={inputMethod === "paste" ? "fill" : "regular"} />
                        Paste text
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {inputMethod === 'file' ? (
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-panel border border-border bg-surface p-8 text-center cursor-pointer hover:border-live hover:bg-surface-2 transition-colors shadow-[var(--shadow-bevel-highlight)]"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.docx,.doc,.txt"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                    {selectedFile ? (
                        <div className="space-y-2">
                            <div className="w-12 h-12 rounded-pill bg-surface-2 flex items-center justify-center mx-auto shadow-[var(--shadow-bevel-inset)]">
                                <FileText size={24} weight="duotone" className="text-live" />
                            </div>
                            <p className="text-foreground">{selectedFile.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {(selectedFile.size / 1024).toFixed(1)} KB
                            </p>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFile(null);
                                }}
                                className="text-xs text-muted-foreground hover:text-danger-text transition-colors"
                            >
                                Remove
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="w-12 h-12 rounded-pill bg-surface-2 flex items-center justify-center mx-auto shadow-[var(--shadow-bevel-inset)]">
                                <Upload size={24} weight="duotone" className="text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-foreground">Drop your résumé here</p>
                                <p className="text-sm text-muted-foreground">or click to browse</p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Supports PDF, DOCX, TXT
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <Label htmlFor="resume-text">Paste your résumé text</Label>
                    <Textarea
                        id="resume-text"
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Copy and paste your résumé content here..."
                        className="min-h-64 text-base md:text-sm resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                        {pastedText.length > 0 && `${pastedText.length} characters`}
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-panel p-3 bg-surface-2 border border-danger-text text-danger-text text-sm flex items-center gap-2">
                    <Warning size={16} weight="bold" />
                    {error}
                </div>
            )}
        </div>
    );

    const renderReviewStep = () => {
        if (!parseResult || !editedData || !reviewConfidence) return null;

        return (
            <div className="space-y-6 -mx-6">
                {/* Confidence Overview */}
                <div className="px-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ConfidenceIndicator score={reviewConfidence.overall} size="lg" />
                    </div>
                    <div className="text-right">
                        {engineLabel && (
                            <p className="text-xs text-live font-semibold">{engineLabel}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Review and edit before saving
                        </p>
                    </div>
                </div>

                {/* Warnings */}
                {parseResult.warnings.length > 0 && (
                    <div className="px-6">
                        <WarningBanner warnings={parseResult.warnings} />
                    </div>
                )}

                {localParseBlocked && (
                    <div className="px-6">
                        <div className="rounded-panel p-3 bg-surface-2 border border-warn text-warn text-sm flex items-start gap-2">
                            <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
                            <span>
                                Confidence is {reviewConfidence.overall}% — needs to be above{" "}
                                {LOCAL_PARSE_ACCEPT_MIN - 1}. Add name, title, experience, and skills
                                (plus email or education), or go back and paste cleaner text.
                            </span>
                        </div>
                    </div>
                )}

                <div>
                    <div className="px-6 space-y-6">
                        <ResumeReviewFields data={editedData} onChange={setEditedData} />
                    </div>
                </div>
            </div>
        );
    };

    const canProceed = () => {
        if (step === 'input') {
            return (inputMethod === 'file' && selectedFile) || (inputMethod === 'paste' && pastedText.trim().length > 50);
        }
        return true;
    };

    const parseButtonLabel = () => {
        if (consentDeclined) return "Parse with basic rules";
        if (!localAiConsent) return "Download model & parse";
        return "Parse on device";
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="w-full max-w-[calc(100%-1rem)] sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {title ? (
                            title
                        ) : (
                            <>
                                <div className="w-8 h-8 rounded-panel bg-surface-2 flex items-center justify-center shadow-[var(--shadow-bevel-inset)]">
                                    <Upload weight="bold" className="text-live" />
                                </div>
                                Import résumé
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <DialogBody key={step} className="-mx-6 px-6 py-1">
                    {step === 'input' && renderInputStep()}
                    {step === 'parsing' && <ResumeParsingStep />}
                    {step === 'review' && renderReviewStep()}
                </DialogBody>

                <DialogFooter className="flex-row justify-between gap-3 border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-between">
                    {step === 'review' ? (
                        <>
                            <Button size="lg" variant="outline" onClick={() => setStep('input')}>
                                <ArrowLeft size={16} className="mr-2" />
                                Back
                            </Button>
                            <Button size="lg" onClick={handleConfirm} disabled={localParseBlocked}>
                                <Check size={16} className="mr-2" />
                                {confirmLabel}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button size="lg" variant="outline" onClick={handleClose} disabled={isProcessing}>
                                Cancel
                            </Button>
                            <Button size="lg"
                                
                                data-testid="resume-import-parse-primary"
                                onClick={handleParse}
                                disabled={!canProceed() || isProcessing}
                            >
                                {isProcessing ? (
                                    <>
                                        <div className="mr-2 h-4 w-4 animate-spin rounded-pill border-2 border-background border-t-transparent" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Cpu size={16} weight="fill" className="mr-2" />
                                        {parseButtonLabel()}
                                        <ArrowRight size={16} className="ml-2" />
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

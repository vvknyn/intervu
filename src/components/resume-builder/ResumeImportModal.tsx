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
import { parseResumeLocally, type LocalParseResult } from "@/lib/local-ai/parse-resume";
import { ModelEnhancementStrip, type EnhancementPhase } from "./ModelEnhancementStrip";
import { InlineSpinner, WaitState } from "@/components/ui/wait-state";
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import { RESUME_IMPORT_PARSE_LINE, RESUME_IMPORT_SEALED_DETAIL, RESUME_IMPORT_SEALED_LINE } from "@/lib/jobs/resume-privacy-copy";
import { sealedAiStatus } from "@/lib/sealed-ai/client";
import { refuseResumeReview, PROFILE_REVIEW_UNREADABLE_ERROR } from "@/lib/resume/profile-review-parse";
import { LEGACY_DOC_MESSAGE } from "@/lib/resume/extract-file-text";
import {
    canAcceptLocalParse,
    missingMatchFields,
    modelReadNeeded,
    scoreLocalParseConfidence,
} from "@/lib/local-ai/parse-confidence";
import type { AgentPreferences } from "@/lib/agent/preferences";
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
    /** The signed-in person's saved preferences, so the review's "Level used for ranking" is the level ranking reads. */
    agentPreferences?: AgentPreferences | null;
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
        <WaitState
            label="Reading your résumé"
            status="Structuring your résumé on this device"
            className="py-12"
        />
    );
}

/** How long the review waits on sealed AI's read before keeping the quick read. */
export const MODEL_READ_LIMIT_MS = 30_000;

function joinWords(words: string[]): string {
    return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : words[0] ?? "";
}

export function ResumeImportModal({ isOpen, onClose, onImport, confirmLabel = "Apply to Resume", title, description, storageNote, funnelContext, agentPreferences }: ResumeImportModalProps) {
    const [step, setStep] = useState<ImportStep>('input');
    const [inputMethod, setInputMethod] = useState<InputMethod>('file');
    const [pastedText, setPastedText] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The PDF is pictures of its pages: its words are being read off them on this device.
    const [readingScan, setReadingScan] = useState(false);
    const [parseResult, setParseResult] = useState<ParsedResumeResult | null>(null);
    const [editedData, setEditedData] = useState<ResumeData | null>(null);
    const [contentType, setContentType] = useState<'pdf' | 'docx' | 'text'>('text');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // The quick read runs in this browser. Sealed AI (Tinfoil) reads it too
    // only when this server has it set up and the quick read missed something
    // ranking uses (`modelReadNeeded`); its read never reaches our servers.
    const [sealedOn, setSealedOn] = useState(false);
    const [sealedHowOpen, setSealedHowOpen] = useState(false);
    const [engineLabel, setEngineLabel] = useState<string | null>(null);
    // Model upgrade of the quick (rules) parse — see `startEnhancement`.
    const [enhancement, setEnhancement] = useState<EnhancementPhase | null>(null);
    const [improved, setImproved] = useState<LocalParseResult | null>(null);
    const enhancementRun = useRef(0);
    const skipEnhancement = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        void sealedAiStatus().then((status) => setSealedOn(status.enabled));
        captureEvent(
            "resume_gate_shown",
            buildResumeFunnelPayload({
                reason: funnelContext?.reason,
                surface: funnelContext?.surface,
                signed_in: funnelContext?.signed_in,
            }),
        );
    }, [isOpen, funnelContext?.reason, funnelContext?.surface, funnelContext?.signed_in]);

    // A new parse (or closing) invalidates any in-flight model upgrade of the old one.
    const abandonEnhancement = () => {
        enhancementRun.current += 1;
        setEnhancement(null);
        setImproved(null);
    };

    const resetState = () => {
        setStep('input');
        setPastedText("");
        setSelectedFile(null);
        setError(null);
        setParseResult(null);
        setEditedData(null);
        setIsProcessing(false);
        setEngineLabel(null);
        abandonEnhancement();
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const selectFile = useCallback((file: File, source: "picker" | "drop") => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (extension === 'pdf') {
            setContentType('pdf');
        } else if (extension === 'docx') {
            setContentType('docx');
        } else if (extension === 'txt') {
            setContentType('text');
        } else {
            setError(extension === 'doc' ? LEGACY_DOC_MESSAGE : "Unsupported file type. Please use PDF, DOCX, or TXT.");
            captureEvent(
                "resume_upload_rejected",
                buildResumeFunnelPayload({
                    source,
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
                source,
                file_type: classifyResumeFileType(extension),
                size_bucket: classifyResumeSizeBucket(file.size),
                ...funnelContext,
            }),
        );
    }, [funnelContext]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Cleared, or picking the same file again (after Remove or a file
        // that couldn't be read) fires no change and the picker looks dead.
        e.target.value = "";
        if (file) selectFile(file, "picker");
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) selectFile(file, "drop");
    }, [selectFile]);

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
            : extractPDFTextInBrowser(arrayBuffer, { onReadingScan: () => setReadingScan(true) }));

        if (result.error) throw new Error(result.error);
        return result.text || "";
    };

    // The quick (rules) parse is instant, so review opens at once; the model —
    // which may be a large first-time download — upgrades it in the background.
    const runParse = async (textContent: string) => {
        const started = Date.now();
        const local = await parseResumeLocally(textContent);
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
                parser_source: "rules",
                engine: "rules",
                section_count: local.data.parsed.experience.length + local.data.parsed.education.length,
                warning_count: local.data.warnings?.length ?? 0,
                ...funnelContext,
            }),
        );
        return local.data.parsed;
    };

    const adoptImproved = (result: LocalParseResult) => {
        setEngineLabel(result.engineLabel);
        setParseResult(result.data);
        setEditedData(result.data.parsed);
        setImproved(null);
        setEnhancement(null);
    };

    // Sealed AI's read, bounded: after MODEL_READ_LIMIT_MS, or when the person
    // skips, the quick read stands and the strip says why. Every way out, a
    // thrown error included, ends the strip: it never spins on.
    const startEnhancement = async (textContent: string) => {
        const run = ++enhancementRun.current;
        setEnhancement("loading");
        const skipped = new Promise<"skipped">((resolve) => {
            skipEnhancement.current = () => resolve("skipped");
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const slow = new Promise<"slow">((resolve) => {
            timer = setTimeout(() => resolve("slow"), MODEL_READ_LIMIT_MS);
        });
        const upgraded = parseResumeLocally(textContent, { withModel: true }).catch(() => null);
        let phase: EnhancementPhase = "unimproved";
        try {
            const outcome = await Promise.race([upgraded, skipped, slow]);
            if (outcome === "skipped" || outcome === "slow") {
                phase = outcome;
            } else if (outcome && outcome.engine !== "heuristic" && !refuseResumeReview(outcome.data.parsed, textContent)) {
                if (enhancementRun.current === run) setImproved(outcome);
                phase = "improved-pending";
            }
        } catch {
            phase = "unimproved";
        } finally {
            clearTimeout(timer);
        }
        if (enhancementRun.current === run) setEnhancement(phase);
    };

    // Untouched quick match → swap in the model's parse silently. Edited → the
    // strip offers it as a button instead of overwriting the user's work.
    useEffect(() => {
        if (improved && parseResult && editedData === parseResult.parsed) adoptImproved(improved);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [improved, parseResult, editedData]);

    const handleParse = async () => {
        abandonEnhancement();
        setIsProcessing(true);
        setReadingScan(false);
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

            const quick = await runParse(textContent);

            // Sealed AI reads it only where this server has it, and only a read
            // it can add to (`modelReadNeeded`): no tokens on a résumé the quick read got.
            if (sealedOn) {
                if (modelReadNeeded(quick)) void startEnhancement(textContent);
                else setEnhancement("not-needed");
            }
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
            setReadingScan(false);
        }
    };

    const reviewConfidence = useMemo(() => {
        if (!editedData) return null;
        return scoreLocalParseConfidence(editedData);
    }, [editedData]);

    const localParseBlocked = editedData !== null && !canAcceptLocalParse(editedData);
    const missingFields = useMemo(() => (editedData ? missingMatchFields(editedData) : []), [editedData]);

    const handleConfirm = () => {
        if (!editedData || !parseResult) return;
        if (!canAcceptLocalParse(editedData)) {
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

    // Privacy block: the résumé is read in this browser, and where this
    // server has sealed AI, what goes to it when the quick read misses something.
    const renderPrivacyConsent = () => (
        <div className="space-y-2 rounded-panel border border-border bg-surface-2 p-4 shadow-[var(--shadow-bevel-inset)]">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <Cpu size={16} className="text-live shrink-0" />
                <span>Read in your browser</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
                {RESUME_IMPORT_PARSE_LINE} {storageNote}
            </p>
            {sealedOn && (
                <p className="text-xs text-muted-foreground leading-relaxed" data-testid="resume-import-model-on">
                    {RESUME_IMPORT_SEALED_LINE}{" "}
                    <button
                        type="button"
                        aria-expanded={sealedHowOpen}
                        onClick={() => setSealedHowOpen((open) => !open)}
                        className="font-semibold text-foreground underline underline-offset-2"
                    >
                        How
                    </button>
                </p>
            )}
            {sealedOn && sealedHowOpen && (
                <p className="text-xs text-muted-foreground leading-relaxed" data-testid="resume-import-sealed-detail">
                    {RESUME_IMPORT_SEALED_DETAIL}
                </p>
            )}
        </div>
    );

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
                        accept=".pdf,.docx,.txt"
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

            {readingScan && isProcessing ? (
                <p className="text-sm text-muted-foreground" role="status" data-testid="resume-import-reading-scan">
                    This PDF is a picture of your résumé, so Velai is reading the words off it on this device. The first one takes a few seconds longer.
                </p>
            ) : null}

            {error && (
                <div className="rounded-panel p-3 bg-surface-2 border border-danger-text text-danger-text text-sm space-y-2" role="alert">
                    <p className="flex items-start gap-2">
                        <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </p>
                    {inputMethod === "file" ? (
                        <Button type="button" variant="outline" size="sm" data-testid="resume-import-paste-instead" onClick={() => { setError(null); setInputMethod("paste"); }}>
                            <ClipboardText size={16} />
                            Paste the text instead
                        </Button>
                    ) : null}
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

                {enhancement && (
                    <ModelEnhancementStrip
                        phase={enhancement}
                        onSkip={() => skipEnhancement.current?.()}
                        onUseImproved={() => improved && adoptImproved(improved)}
                    />
                )}

                {/* Warnings */}
                {parseResult.warnings.length > 0 && (
                    <div className="px-6">
                        <WarningBanner warnings={parseResult.warnings} />
                    </div>
                )}

                {missingFields.length > 0 && (
                    <div className="px-6">
                        <div
                            className="rounded-panel p-3 bg-surface-2 border border-warn text-warn text-sm flex items-start gap-2"
                            data-testid="resume-import-missing"
                            data-blocked={localParseBlocked}
                        >
                            <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
                            <span>
                                {localParseBlocked
                                    ? `We couldn't find a job title or any skills, so there's nothing to match jobs on yet. Add your most recent job title below.`
                                    : `We couldn't find your ${joinWords(missingFields)}. Add ${missingFields.length === 1 ? "it" : "them"} below for closer matches, or carry on with what we read.`}
                            </span>
                        </div>
                    </div>
                )}

                <div>
                    <div className="px-6 space-y-6">
                        <ResumeReviewFields data={editedData} onChange={setEditedData} agentPreferences={agentPreferences} />
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
                            <Button variant="outline" onClick={() => setStep('input')}>
                                <ArrowLeft size={16} className="mr-2" />
                                Back
                            </Button>
                            <Button onClick={handleConfirm} disabled={localParseBlocked}>
                                <Check size={16} className="mr-2" />
                                {confirmLabel}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
                                Cancel
                            </Button>
                            <Button
                                
                                data-testid="resume-import-parse-primary"
                                onClick={handleParse}
                                disabled={!canProceed() || isProcessing}
                            >
                                {isProcessing ? (
                                    <>
                                        <InlineSpinner className="mr-2" />
                                        {readingScan ? "Reading the scan…" : "Reading…"}
                                    </>
                                ) : (
                                    <>
                                        <Cpu size={16} weight="fill" className="mr-2" />
                                        Read my résumé
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

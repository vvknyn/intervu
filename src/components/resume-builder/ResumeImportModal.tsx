"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfidenceIndicator, ConfidenceBadge, WarningBanner } from "./ConfidenceIndicator";
import { ResumeData, ResumeExperience, ResumeCompetencyCategory, ResumeEducation, ParsedResumeResult } from "@/types/resume";
import { parseResumeWithAI, extractPDFText, extractDocxText } from "@/actions/resume";
import { readLocalAiEnabled, writeLocalAiEnabled } from "@/lib/local-ai/flag";
import { readLocalAiConsent, grantLocalAiConsent } from "@/lib/local-ai/consent";
import { parseResumeLocally } from "@/lib/local-ai/parse-resume";
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import {
    canAcceptLocalParse,
    LOCAL_PARSE_ACCEPT_MIN,
    scoreLocalParseConfidence,
} from "@/lib/local-ai/parse-confidence";
import { getEngineLabel, initLocalAiLadder, probeBestEngine } from "@/lib/local-ai/ladder";
import { FileText, Upload, ClipboardText, ArrowRight, ArrowLeft, Check, Sparkle, Warning, Cpu } from "@phosphor-icons/react";
import { sentinelMessage } from "@/lib/llm/sentinels";

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
     * Dialog title/description overrides. Default to today's copy exactly
     * (the icon + "Import Resume" title, and the step-conditional
     * description below) — the resume-builder's own mount stays byte-
     * identical. /jobs (ITEM J, 2026-08-15) passes both: the "best match"
     * sort tab used to summon this modal with zero explanation, so a caller
     * that knows WHY it's opening the importer can now say so.
     */
    title?: string;
    description?: string;
}

type ImportStep = 'input' | 'parsing' | 'review';
type InputMethod = 'file' | 'paste';

/**
 * The modal's "parsing" step markup, extracted to a standalone export so the
 * design-conformance mock route (src/app/mock/resume) can render this exact
 * state without duplicating it or reaching into the modal's internal step
 * machinery — single source of truth for what "parsing" looks like.
 */
export function ResumeParsingStep({ localAiEnabled }: { localAiEnabled: boolean }) {
    return (
        <div className="py-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-pill bg-muted flex items-center justify-center mx-auto animate-pulse">
                {localAiEnabled ? (
                    <Cpu size={24} weight="fill" className="text-brand" />
                ) : (
                    <Sparkle size={24} weight="fill" className="text-brand" />
                )}
            </div>
            <div>
                <p className="text-foreground">Parsing your resume...</p>
                <p className="text-sm text-muted-foreground mt-1">
                    {localAiEnabled
                        ? "Structuring on this device — no cloud LLM"
                        : "AI is extracting structured information"}
                </p>
            </div>
            <div className="w-48 h-1 rounded-pill bg-secondary mx-auto overflow-hidden">
                <div className="h-full w-full rounded-pill bg-primary animate-pulse" />
            </div>
        </div>
    );
}

export function ResumeImportModal({ isOpen, onClose, onImport, confirmLabel = "Apply to Resume", title, description }: ResumeImportModalProps) {
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

    const [localAiEnabled, setLocalAiEnabled] = useState(false);
    const [localAiConsent, setLocalAiConsent] = useState(false);
    const [engineLabel, setEngineLabel] = useState<string | null>(null);
    const [probedEngine, setProbedEngine] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setLocalAiEnabled(readLocalAiEnabled());
        setLocalAiConsent(readLocalAiConsent());
        if (readLocalAiEnabled()) {
            void probeBestEngine().then((id) => setProbedEngine(getEngineLabel(id)));
        }
    }, [isOpen]);

    const resetState = () => {
        setStep('input');
        setPastedText("");
        setSelectedFile(null);
        setError(null);
        setParseResult(null);
        setEditedData(null);
        setIsProcessing(false);
        setEngineLabel(null);
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
                return;
            }
            setSelectedFile(file);
            setError(null);
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
                return;
            }
            setSelectedFile(file);
            setError(null);
        }
    }, []);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    // Convert ArrayBuffer to base64 (browser-compatible)
    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
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

        // Local mode: extract in-browser (unpdf/mammoth) — the résumé never
        // leaves the browser. Otherwise unchanged: base64 + server action.
        const result = localAiEnabled
            ? await (isDocx ? extractDocxTextInBrowser(arrayBuffer) : extractPDFTextInBrowser(arrayBuffer))
            : await (isDocx
                  ? extractDocxText(arrayBufferToBase64(arrayBuffer))
                  : extractPDFText(arrayBufferToBase64(arrayBuffer)));

        if (result.error) throw new Error(result.error);
        return result.text || "";
    };

    const runParse = async (textContent: string) => {
        if (localAiEnabled) {
            const local = await parseResumeLocally(textContent);
            setEngineLabel(local.engineLabel);
            setParseResult(local.data);
            setEditedData(local.data.parsed);
        } else {
            const result = await parseResumeWithAI(textContent, contentType);
            if (result.error) throw new Error(result.error);
            if (!result.data) throw new Error("Failed to parse resume");
            setEngineLabel(null);
            setParseResult(result.data);
            setEditedData(result.data.parsed);
        }
        setStep('review');
    };

    const handleParse = async () => {
        setIsProcessing(true);
        setError(null);

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

            // Local mode: consent-first — no model download until Enable.
            if (localAiEnabled && !localAiConsent) {
                setStep('parsing');
                grantLocalAiConsent();
                setLocalAiConsent(true);
                await initLocalAiLadder();
            } else if (localAiEnabled) {
                setStep('parsing');
                await initLocalAiLadder();
            } else {
                setStep('parsing');
            }

            await runParse(textContent);
        } catch (e: any) {
            setError(sentinelMessage(e) || "Failed to parse resume");
            setStep('input');
        } finally {
            setIsProcessing(false);
        }
    };

    const reviewConfidence = useMemo(() => {
        if (!editedData) return null;
        if (localAiEnabled) {
            return scoreLocalParseConfidence(editedData);
        }
        return parseResult?.confidence ?? null;
    }, [editedData, localAiEnabled, parseResult?.confidence]);

    const localParseBlocked =
        localAiEnabled && reviewConfidence !== null && !canAcceptLocalParse(reviewConfidence);

    const handleConfirm = () => {
        if (!editedData || !parseResult) return;
        if (localAiEnabled && reviewConfidence && !canAcceptLocalParse(reviewConfidence)) {
            return;
        }
        const overall = reviewConfidence?.overall ?? parseResult.confidence.overall;
        const sourceLabel =
            inputMethod === "file" && selectedFile
                ? selectedFile.name
                : "Pasted text";
        onImport(editedData, contentType, overall, sourceLabel);
        handleClose();
    };

    // Edit handlers for the review step
    const updateProfile = (field: keyof ResumeData['profile'], value: string | number) => {
        if (!editedData) return;
        setEditedData({
            ...editedData,
            profile: { ...editedData.profile, [field]: value }
        });
    };

    const updateExperience = (index: number, field: keyof ResumeExperience, value: string) => {
        if (!editedData) return;
        const newExp = [...editedData.experience];
        newExp[index] = { ...newExp[index], [field]: value };
        setEditedData({ ...editedData, experience: newExp });
    };

    const updateCompetency = (index: number, skills: string[]) => {
        if (!editedData) return;
        const newComp = [...editedData.competencies];
        newComp[index] = { ...newComp[index], skills };
        setEditedData({ ...editedData, competencies: newComp });
    };

    const updateEducation = (index: number, field: keyof ResumeEducation, value: string) => {
        if (!editedData) return;
        const newEdu = [...editedData.education];
        newEdu[index] = { ...newEdu[index], [field]: value };
        setEditedData({ ...editedData, education: newEdu });
    };

    const renderLocalAiConsent = () => {
        return (
            <div className="rounded-panel p-3.5 border border-border bg-muted space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cpu size={16} className="text-brand shrink-0" />
                        <span>On-Device AI Parser</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setLocalAiEnabled(true);
                                writeLocalAiEnabled(true);
                            }}
                            className={`min-h-6 rounded-ctl px-3 text-xs font-semibold leading-none transition-colors ${
                                localAiEnabled
                                    ? "text-foreground underline underline-offset-2"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            On-Device AI
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setLocalAiEnabled(false);
                                writeLocalAiEnabled(false);
                            }}
                            className={`min-h-6 rounded-ctl px-3 text-xs font-semibold leading-none transition-colors ${
                                !localAiEnabled
                                    ? "text-foreground underline underline-offset-2"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Standard (No AI)
                        </button>
                    </div>
                </div>
                {localAiEnabled ? (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        🔒 100% On-Device AI: Your résumé never leaves this device. Download and run a private model
                        {probedEngine ? ` (${probedEngine})` : " (e.g. Llama 3.2 3B on WebGPU)"} directly in your browser.
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Standard rules extraction: Extracts document sections using built-in heuristics without running local AI models.
                    </p>
                )}
            </div>
        );
    };

    const renderInputStep = () => (
        <div className="space-y-6">
            {renderLocalAiConsent()}

            {/* Method Toggle - Segmented Control Style */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setInputMethod('file')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm transition-all relative ${inputMethod === 'file'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Upload size={16} weight={inputMethod === 'file' ? 'fill' : 'regular'} />
                    Upload File
                    {inputMethod === 'file' && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
                    )}
                </button>
                <button
                    onClick={() => setInputMethod('paste')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm transition-all relative ${inputMethod === 'paste'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <ClipboardText size={16} weight={inputMethod === 'paste' ? 'fill' : 'regular'} />
                    Paste Text
                    {inputMethod === 'paste' && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
                    )}
                </button>
            </div>

            {inputMethod === 'file' ? (
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-panel border border-border p-8 text-center cursor-pointer hover:border-brand hover:bg-muted transition-colors"
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
                            <div className="w-12 h-12 rounded-pill bg-muted flex items-center justify-center mx-auto">
                                <FileText size={24} weight="duotone" className="text-brand" />
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
                            <div className="w-12 h-12 rounded-pill bg-secondary flex items-center justify-center mx-auto">
                                <Upload size={24} weight="duotone" className="text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-foreground">Drop your resume here</p>
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
                    <Label htmlFor="resume-text">Paste your resume text</Label>
                    <Textarea
                        id="resume-text"
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Copy and paste your resume content here..."
                        className="min-h-64 text-base md:text-sm resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                        {pastedText.length > 0 && `${pastedText.length} characters`}
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-panel p-3 bg-muted border border-danger-text text-danger-text text-sm flex items-center gap-2">
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
                            <p className="text-xs text-brand font-semibold">{engineLabel}</p>
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
                        <div className="rounded-panel p-3 bg-muted border border-warn text-warn text-sm flex items-start gap-2">
                            <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
                            <span>
                                Confidence is {reviewConfidence.overall}% — needs to be above{" "}
                                {LOCAL_PARSE_ACCEPT_MIN - 1}. Add name, title, experience, and skills
                                (plus email or education), or go back and paste cleaner text.
                            </span>
                        </div>
                    </div>
                )}

                <ScrollArea className="min-h-0 flex-1 max-h-[min(50dvh,400px)]">
                    <div className="px-6 space-y-6">
                        {/* Profile Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    Profile
                                    <ConfidenceBadge score={reviewConfidence.profile} section="Profile" />
                                </h4>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Name</Label>
                                    <Input
                                        value={editedData.profile.name || ""}
                                        onChange={(e) => updateProfile('name', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Profession</Label>
                                    <Input
                                        value={editedData.profile.profession}
                                        onChange={(e) => updateProfile('profession', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Years of Experience</Label>
                                    <Input
                                        type="number"
                                        value={editedData.profile.yearsOfExperience}
                                        onChange={(e) => updateProfile('yearsOfExperience', parseInt(e.target.value) || 0)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Location</Label>
                                    <Input
                                        value={editedData.profile.location}
                                        onChange={(e) => updateProfile('location', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Email</Label>
                                    <Input
                                        value={editedData.profile.email}
                                        onChange={(e) => updateProfile('email', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Phone</Label>
                                    <Input
                                        value={editedData.profile.phone}
                                        onChange={(e) => updateProfile('phone', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">LinkedIn</Label>
                                    <Input
                                        value={editedData.profile.linkedin || ""}
                                        onChange={(e) => updateProfile('linkedin', e.target.value)}
                                        className="h-8 text-base md:text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Experience Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    Experience ({editedData.experience.length})
                                    <ConfidenceBadge score={reviewConfidence.experience} section="Experience" />
                                </h4>
                            </div>
                            <div className="space-y-4">
                                {editedData.experience.map((exp, idx) => (
                                    <div key={exp.id} className="rounded-panel p-3 bg-muted space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                value={exp.company}
                                                onChange={(e) => updateExperience(idx, 'company', e.target.value)}
                                                placeholder="Company"
                                                className="h-8 text-base md:text-sm"
                                            />
                                            <Input
                                                value={exp.role}
                                                onChange={(e) => updateExperience(idx, 'role', e.target.value)}
                                                placeholder="Role"
                                                className="h-8 text-base md:text-sm"
                                            />
                                        </div>
                                        <Input
                                            value={exp.dates}
                                            onChange={(e) => updateExperience(idx, 'dates', e.target.value)}
                                            placeholder="Dates"
                                            className="h-8 text-base md:text-sm"
                                        />
                                        <Textarea
                                            value={exp.description}
                                            onChange={(e) => updateExperience(idx, 'description', e.target.value)}
                                            placeholder="Description"
                                            className="min-h-16 text-base md:text-xs"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Competencies Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    Skills
                                    <ConfidenceBadge score={reviewConfidence.competencies} section="Skills" />
                                </h4>
                            </div>
                            <div className="space-y-3">
                                {editedData.competencies.map((comp, idx) => (
                                    <div key={idx} className="space-y-1.5">
                                        <Label className="text-xs">{comp.category}</Label>
                                        <Input
                                            value={comp.skills.join(', ')}
                                            onChange={(e) => updateCompetency(idx, e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                            placeholder="Skills (comma separated)"
                                            className="h-8 text-base md:text-sm"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Education Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    Education ({editedData.education.length})
                                    <ConfidenceBadge score={reviewConfidence.education} section="Education" />
                                </h4>
                            </div>
                            <div className="space-y-3">
                                {editedData.education.map((edu, idx) => (
                                    <div key={edu.id} className="rounded-panel p-3 bg-muted space-y-2">
                                        <Input
                                            value={edu.degree}
                                            onChange={(e) => updateEducation(idx, 'degree', e.target.value)}
                                            placeholder="Degree"
                                            className="h-8 text-base md:text-sm"
                                        />
                                        <div className="grid grid-cols-3 gap-2">
                                            <Input
                                                value={edu.institution}
                                                onChange={(e) => updateEducation(idx, 'institution', e.target.value)}
                                                placeholder="Institution"
                                                className="h-8 text-base md:text-sm col-span-2"
                                            />
                                            <Input
                                                value={edu.year || ""}
                                                onChange={(e) => updateEducation(idx, 'year', e.target.value)}
                                                placeholder="Year"
                                                className="h-8 text-base md:text-sm"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Summary Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    Summary
                                    <ConfidenceBadge score={reviewConfidence.summary} section="Summary" />
                                </h4>
                            </div>
                            <Textarea
                                value={editedData.generatedSummary}
                                onChange={(e) => setEditedData({ ...editedData, generatedSummary: e.target.value })}
                                placeholder="Professional summary"
                                className="min-h-20 text-base md:text-sm"
                            />
                        </div>
                    </div>
                </ScrollArea>
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
        if (localAiEnabled && !localAiConsent) return "Download model & parse";
        if (localAiEnabled) return "Parse on device";
        return "Parse with standard rules";
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="flex w-full max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-panel bg-white max-h-[90dvh] dark:bg-muted sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {title ? (
                            title
                        ) : (
                            <>
                                <div className="w-8 h-8 rounded-panel bg-muted flex items-center justify-center">
                                    <Upload weight="bold" className="text-brand" />
                                </div>
                                Import Resume
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {description ? description : (
                            <>
                                {step === 'input' && (localAiEnabled ? "Upload or paste — 100% on-device AI inference" : "Upload a file or paste your resume text")}
                                {step === 'parsing' && (localAiEnabled ? "On-device AI is analyzing your résumé..." : "Analyzing your resume...")}
                                {step === 'review' && "Review and edit the extracted information"}
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden py-4">
                    {step === 'input' && renderInputStep()}
                    {step === 'parsing' && <ResumeParsingStep localAiEnabled={localAiEnabled} />}
                    {step === 'review' && renderReviewStep()}
                </div>

                <div className="flex justify-between gap-3 border-t pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {step === 'review' ? (
                        <>
                            <Button variant="outline" className="h-11 min-h-11" onClick={() => setStep('input')}>
                                <ArrowLeft size={16} className="mr-2" />
                                Back
                            </Button>
                            <Button className="h-11 min-h-11" onClick={handleConfirm} disabled={localParseBlocked}>
                                <Check size={16} className="mr-2" />
                                {confirmLabel}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" className="h-11 min-h-11" onClick={handleClose} disabled={isProcessing}>
                                Cancel
                            </Button>
                            <Button className="h-11 min-h-11" onClick={handleParse} disabled={!canProceed() || isProcessing}>
                                {isProcessing ? (
                                    <>
                                        <div className="w-4 h-4 rounded-pill border-2 border-background border-t-transparent animate-spin mr-2" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        {localAiEnabled ? (
                                            <Cpu size={16} weight="fill" className="mr-2" />
                                        ) : (
                                            <Sparkle size={16} weight="fill" className="mr-2" />
                                        )}
                                        {parseButtonLabel()}
                                        <ArrowRight size={16} className="ml-2" />
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

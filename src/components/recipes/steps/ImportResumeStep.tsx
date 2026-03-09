"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Upload, ClipboardText, Check, Sparkle } from "@phosphor-icons/react";
import { updateResume } from "@/actions/profile";

type InputMethod = "file" | "paste";

interface ImportResumeStepProps {
    resume: string;
    onResumeChange: (text: string) => void;
    onValidityChange?: (valid: boolean) => void;
}

export function ImportResumeStep({ resume, onResumeChange, onValidityChange }: ImportResumeStepProps) {
    const [inputMethod, setInputMethod] = useState<InputMethod>("paste");
    const [pastedText, setPastedText] = useState(resume || "");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(!!resume);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const hasResume = !!resume;

    // Sync validity state when resume prop changes (e.g., loaded asynchronously)
    useEffect(() => {
        if (resume) {
            onValidityChange?.(true);
        }
    }, [resume, onValidityChange]);

    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const ext = file.name.split(".").pop()?.toLowerCase();
            if (!["pdf", "docx", "doc", "txt"].includes(ext || "")) {
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
            const ext = file.name.split(".").pop()?.toLowerCase();
            if (!["pdf", "docx", "doc", "txt"].includes(ext || "")) {
                setError("Unsupported file type. Please use PDF, DOCX, or TXT.");
                return;
            }
            setSelectedFile(file);
            setError(null);
        }
    }, []);

    const processAndSave = async () => {
        setIsProcessing(true);
        setError(null);
        try {
            let textContent: string;

            if (inputMethod === "file" && selectedFile) {
                const ext = selectedFile.name.split(".").pop()?.toLowerCase();
                if (ext === "txt") {
                    textContent = await selectedFile.text();
                } else {
                    const arrayBuffer = await selectedFile.arrayBuffer();
                    const base64 = arrayBufferToBase64(arrayBuffer);
                    // Dynamic import to extract text
                    const { extractPDFText, extractDocxText } = await import("@/actions/resume");
                    if (ext === "pdf") {
                        const result = await extractPDFText(base64);
                        if (result.error) throw new Error(result.error);
                        textContent = result.text || "";
                    } else {
                        const result = await extractDocxText(base64);
                        if (result.error) throw new Error(result.error);
                        textContent = result.text || "";
                    }
                }
            } else if (inputMethod === "paste" && pastedText.trim()) {
                textContent = pastedText;
            } else {
                throw new Error("No content provided");
            }

            // Save resume text
            await updateResume(textContent);
            onResumeChange(textContent);
            setSaved(true);
            onValidityChange?.(true);
        } catch (e: any) {
            setError(e.message || "Failed to import resume");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-4 animate-in fade-in">
            {hasResume && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-sm">
                    <Check size={16} weight="bold" />
                    <span>Resume imported ({resume.length.toLocaleString()} chars). You can update or continue.</span>
                </div>
            )}

            {/* Method toggle */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setInputMethod("file")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-all relative ${
                        inputMethod === "file" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <Upload size={16} weight={inputMethod === "file" ? "fill" : "regular"} />
                    Upload File
                    {inputMethod === "file" && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
                    )}
                </button>
                <button
                    onClick={() => setInputMethod("paste")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-all relative ${
                        inputMethod === "paste" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <ClipboardText size={16} weight={inputMethod === "paste" ? "fill" : "regular"} />
                    Paste Text
                    {inputMethod === "paste" && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
                    )}
                </button>
            </div>

            {inputMethod === "file" ? (
                <div
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-brand/50 hover:bg-brand/5 transition-colors"
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
                            <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center mx-auto">
                                <FileText size={20} weight="duotone" className="text-brand" />
                            </div>
                            <p className="font-medium text-sm">{selectedFile.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {(selectedFile.size / 1024).toFixed(1)} KB
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center mx-auto">
                                <Upload size={20} weight="duotone" className="text-muted-foreground" />
                            </div>
                            <p className="font-medium text-sm">Drop your resume here</p>
                            <p className="text-xs text-muted-foreground">PDF, DOCX, or TXT</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="resume-text" className="text-xs">Paste your resume text</Label>
                        <span className="text-[10px] text-muted-foreground">{pastedText.length} chars</span>
                    </div>
                    <Textarea
                        id="resume-text"
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Paste your resume content here..."
                        className="min-h-[200px] text-sm resize-none font-mono"
                    />
                </div>
            )}

            {error && (
                <p className="text-xs text-destructive">{error}</p>
            )}

            <Button
                onClick={processAndSave}
                disabled={isProcessing || (inputMethod === "file" ? !selectedFile : !pastedText.trim())}
                className="w-full"
            >
                {isProcessing ? (
                    <span className="flex items-center gap-2">
                        <Sparkle size={16} className="animate-spin" />
                        Processing...
                    </span>
                ) : (
                    "Import Resume"
                )}
            </Button>
        </div>
    );
}

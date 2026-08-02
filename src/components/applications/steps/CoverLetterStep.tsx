"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Copy,
    Check,
    PencilSimple,
    Lightbulb,
    ArrowRight
} from "@phosphor-icons/react";
import { ApplicationDraft } from "../ApplicationWizard";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";

interface CoverLetterStepProps {
    draft: ApplicationDraft;
    onUpdate: (updates: Partial<ApplicationDraft>) => void;
}

export function CoverLetterStep({ draft, onUpdate }: CoverLetterStepProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [coverLetter, setCoverLetter] = useState(draft.coverLetter || "");
    const [skipped, setSkipped] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(coverLetter);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleEdit = (text: string) => {
        setCoverLetter(text);
        onUpdate({ coverLetter: text });
    };

    const handleSkip = () => {
        // Mark step as intentionally skipped
        setSkipped(true);
        onUpdate({ coverLetter: undefined });
    };

    const handleWriteOwn = () => {
        setSkipped(false);
        setIsEditing(true);
    };

    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight">Cover Letter</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    Write a cover letter for this application, or skip it for now.
                </p>
            </div>

            {/* Cover Letter Content */}
            {!coverLetter && !isEditing ? (
                <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-4 text-brand">
                        <PencilSimple size={32} />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Write a Cover Letter</h3>
                    <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto leading-relaxed">
                        Write your own cover letter for {draft.jobAnalysis?.companyName || "this role"}, or skip it and add one later.
                    </p>

                    <div className="flex gap-3 justify-center mb-6">
                        <Button
                            onClick={handleWriteOwn}
                            className="gap-2"
                            size="lg"
                            variant="brand"
                        >
                            <PencilSimple size={18} />
                            Write Your Own
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleSkip}
                            size="lg"
                        >
                            Skip for Now
                        </Button>
                    </div>

                    <McpHandoffNote className="text-left" />
                </div>
            ) : (
                <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Cover Letter</span>
                            <span className="text-xs text-muted-foreground">
                                for {draft.jobAnalysis?.companyName}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsEditing(!isEditing)}
                                className="gap-1.5 h-8"
                            >
                                <PencilSimple size={14} />
                                {isEditing ? "Preview" : "Edit"}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCopy}
                                className="gap-1.5 h-8"
                            >
                                {copied ? (
                                    <>
                                        <Check size={14} className="text-brand" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy size={14} />
                                        Copy
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        {isEditing ? (
                            <Textarea
                                value={coverLetter}
                                onChange={(e) => handleEdit(e.target.value)}
                                className="min-h-[400px] text-base leading-relaxed resize-none border-0 focus-visible:ring-0 p-0 shadow-none"
                                placeholder="Write your cover letter..."
                                autoFocus
                            />
                        ) : (
                            <div className="prose prose-sm max-w-none text-foreground/80">
                                {coverLetter.split('\n').map((paragraph, i) => (
                                    <p key={i} className="mb-4 text-base leading-relaxed last:mb-0">
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Completion nudges */}
            {coverLetter && (
                <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 flex items-center gap-3">
                    <ArrowRight size={20} className="text-brand shrink-0" weight="bold" />
                    <p className="text-sm font-medium">Cover letter ready — click <strong>Continue</strong> to review everything.</p>
                </div>
            )}

            {skipped && !coverLetter && (
                <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 flex items-center gap-3">
                    <ArrowRight size={20} className="text-brand shrink-0" weight="bold" />
                    <p className="text-sm font-medium">You can add a cover letter later. Click <strong>Continue</strong> to review.</p>
                </div>
            )}

            {/* Tips */}
            <div className="bg-muted/20 border border-border/50 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                        <Lightbulb size={16} className="text-brand" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-foreground mb-2">Tips for a great cover letter</p>
                        <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
                            <li>Personalize the opening with specific details about the company</li>
                            <li>Highlight 2-3 achievements that match the job requirements</li>
                            <li>Keep it concise - ideally under 400 words</li>
                            <li>End with a clear call to action</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

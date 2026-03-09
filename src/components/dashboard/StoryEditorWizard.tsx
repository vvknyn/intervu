"use client";

import { useState, useEffect } from "react";
import { StarStory } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Sparkle, ArrowRight, ArrowLeft, Check, FloppyDisk, MagicWand } from "@phosphor-icons/react";
import { convertBlobToStar } from "@/actions/parse-stories";
import { cn } from "@/lib/utils";
import { COMMON_QUESTIONS } from "@/lib/interview-questions";

interface StoryEditorWizardProps {
    isOpen: boolean;
    onClose: () => void;
    story?: StarStory | null;
    onSave: (story: StarStory) => void;
}

type WizardStep = 'draft' | 'refine' | 'meta';

export function StoryEditorWizard({ isOpen, onClose, story, onSave }: StoryEditorWizardProps) {
    const [step, setStep] = useState<WizardStep>('draft');
    const [formData, setFormData] = useState<Partial<StarStory>>({
        title: "",
        content: "",
        situation: "",
        task: "",
        action: "",
        result: "",
        importance: 'medium',
        type: 'star'
    });
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isTitleFocused, setIsTitleFocused] = useState(false);


    // Reset or populate on open
    useEffect(() => {
        if (isOpen) {
            if (story) {
                setFormData({ ...story });
                // If it's an existing STAR story, jump to refine. If it's a blob/draft, go to draft.
                if (story.type === 'star' && story.situation) {
                    setStep('refine');
                } else {
                    setStep('draft');
                }
            } else {
                // New story
                setFormData({
                    id: crypto.randomUUID(),
                    title: "",
                    content: "",
                    situation: "",
                    task: "",
                    action: "",
                    result: "",
                    importance: 'medium',
                    type: 'blob'
                });
                setStep('draft');
            }
        }
    }, [isOpen, story]);

    const handleAnalyze = async () => {
        if (!formData.content || formData.content.trim().length < 20) return;

        setIsAnalyzing(true);
        try {
            const result = await convertBlobToStar(formData.content, formData.title);
            if (result.data) {
                setFormData(prev => ({
                    ...prev,
                    ...result.data,
                    type: 'star',
                    // Keep original content as backup/source
                    content: prev.content
                }));
                setStep('refine');
            }
        } catch (error) {
            console.error("Analysis failed:", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSave = () => {
        // Ensure required fields
        if (!formData.title) formData.title = "Untitled Story";

        onSave(formData as StarStory);
        onClose();
    };

    const steps = [
        { id: 'draft', label: 'Draft' },
        { id: 'refine', label: 'Refine STAR' },
        { id: 'meta', label: 'Finalize' }
    ];

    const currentStepIndex = steps.findIndex(s => s.id === step);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="pr-8">
                    <div className="flex items-center justify-between mb-2">
                        <DialogTitle>{story ? 'Edit Story' : 'New STAR Story'}</DialogTitle>
                        {/* Stepper */}
                        <div className="flex items-center gap-2 text-xs">
                            {steps.map((s, i) => (
                                <div key={s.id} className={cn("flex items-center gap-1",
                                    i <= currentStepIndex ? "text-primary font-medium" : "text-muted-foreground"
                                )}>
                                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center border",
                                        i < currentStepIndex ? "bg-primary border-primary text-primary-foreground" :
                                            i === currentStepIndex ? "border-primary text-primary" : "border-muted-foreground/30"
                                    )}>
                                        {i < currentStepIndex ? <Check size={10} weight="bold" /> : i + 1}
                                    </div>
                                    <span className="hidden sm:inline">{s.label}</span>
                                    {i < steps.length - 1 && <div className="w-4 h-px bg-muted-foreground/20 mx-1" />}
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogDescription>
                        {step === 'draft' && "Dump your thoughts. Don't worry about structure yet."}
                        {step === 'refine' && "Refine the structured analysis. Be specific and quantitative."}
                        {step === 'meta' && "Add final touches to categorize this story."}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4 px-1">
                    {step === 'draft' && (
                        <div className="space-y-4 max-w-3xl mx-auto">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-semibold">Story Draft / Notes</Label>
                                    <span className="text-xs text-muted-foreground">
                                        {formData.content?.length || 0} chars
                                    </span>
                                </div>
                                <div className="relative">
                                    <Textarea
                                        value={formData.content || ''}
                                        onChange={e => setFormData({ ...formData, content: e.target.value })}
                                        placeholder="Paste your resume bullet point, or just dump your thoughts here.&#13;&#13;Example:&#13;I led a project to migrate our database... We faced issues with latency... I optimized the queries and reduced load times by 50%..."
                                        className="min-h-[320px] font-mono text-sm resize-none bg-muted/10 focus:bg-background border-border/60 leading-relaxed p-4 shadow-inner"
                                    />
                                    <div className="absolute bottom-3 right-3">
                                        {formData.content && formData.content.length > 20 && (
                                            <div className="text-[10px] px-2 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-200 dark:border-green-800 flex items-center gap-1">
                                                <Check size={10} weight="bold" />
                                                Ready to analyze
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Don't worry about formatting. The AI will structure this into Situation, Task, Action, and Result.
                                </p>
                            </div>
                        </div>
                    )}

                    {step === 'refine' && (
                        <div className="space-y-6">
                            <div className="bg-brand/5 border border-brand/10 p-4 rounded-lg flex items-start gap-3 mb-6">
                                <Sparkle size={18} weight="fill" className="text-brand shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-brand">AI Analysis Complete</p>
                                    <p className="text-xs text-muted-foreground">
                                        Review the extracted STAR components. Make edits to ensure accuracy and punchiness.
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Situation</Label>
                                            <span className="text-[10px] text-muted-foreground/60">The Setup</span>
                                        </div>
                                        <Textarea
                                            value={formData.situation || ''}
                                            onChange={e => setFormData({ ...formData, situation: e.target.value })}
                                            placeholder="Context and background..."
                                            className="h-28 text-sm resize-none bg-muted/20 focus:bg-background transition-colors"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Task</Label>
                                            <span className="text-[10px] text-muted-foreground/60">The Goal</span>
                                        </div>
                                        <Textarea
                                            value={formData.task || ''}
                                            onChange={e => setFormData({ ...formData, task: e.target.value })}
                                            placeholder="Your specific role and goal..."
                                            className="h-28 text-sm resize-none bg-muted/20 focus:bg-background transition-colors"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Action</Label>
                                        <span className="text-[10px] text-muted-foreground/60">The Execution (Most Important)</span>
                                    </div>
                                    <Textarea
                                        value={formData.action || ''}
                                        onChange={e => setFormData({ ...formData, action: e.target.value })}
                                        placeholder="What you did (use 'I', not 'We')..."
                                        className="h-32 text-sm resize-none bg-muted/20 focus:bg-background transition-colors"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Result</Label>
                                        <span className="text-[10px] text-muted-foreground/60">The Impact</span>
                                    </div>
                                    <Textarea
                                        value={formData.result || ''}
                                        onChange={e => setFormData({ ...formData, result: e.target.value })}
                                        placeholder="Outcome, metrics, and impact..."
                                        className="h-24 text-sm resize-none bg-muted/20 focus:bg-background transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'meta' && (
                        <div className="space-y-6">
                            {/* Question Dropdown */}
                            <div className="space-y-1.5">
                                <Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
                                    Question Answered
                                </Label>
                                <div className="relative group/question">
                                    <Input
                                        value={formData.question || ''}
                                        onChange={e => {
                                            setFormData({ ...formData, question: e.target.value });
                                            setIsTitleFocused(true);
                                        }}
                                        onFocus={() => setIsTitleFocused(true)}
                                        onBlur={() => {
                                            setTimeout(() => setIsTitleFocused(false), 200);
                                        }}
                                        placeholder="e.g. Tell me about a time you failed..."
                                        className="bg-muted/30 border-input/60 focus:bg-background focus:border-brand/50 transition-all"
                                    />
                                    {isTitleFocused && (
                                        <div className="absolute z-10 w-full mt-1 bg-popover/95 backdrop-blur-sm border border-border/50 rounded-lg shadow-xl max-h-60 overflow-y-auto p-1">
                                            {COMMON_QUESTIONS.filter(q =>
                                                !formData.question || q.toLowerCase().includes(formData.question.toLowerCase())
                                            ).map((q, i) => (
                                                <button
                                                    key={i}
                                                    className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-brand/10 hover:text-brand transition-colors text-foreground/80"
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setFormData({ ...formData, question: q });
                                                        setIsTitleFocused(false);
                                                    }}
                                                >
                                                    {q}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    Categorizing your story helps AI recommend it for the right interview questions.
                                </p>
                            </div>

                            {/* Story Title */}
                            <div className="space-y-1.5">
                                <Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
                                    Story Title <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={formData.title || ''}
                                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="e.g. Critical Bug Fix"
                                    className="text-lg font-semibold h-11 border-input/60"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    A short, memorable name for you to reference this story.
                                </p>
                            </div>

                            {/* Importance */}
                            <div className="space-y-1.5">
                                <Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
                                    Importance
                                </Label>
                                <Select
                                    value={formData.importance || 'medium'}
                                    onValueChange={(v: any) => setFormData({ ...formData, importance: v })}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select importance" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="low">Low - Minor achievement</SelectItem>
                                        <SelectItem value="medium">Medium - Good example</SelectItem>
                                        <SelectItem value="high">High - Top 5 career highlight</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Future: Tags input could go here */}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t pt-4">
                    {step === 'draft' ? (
                        <div className="flex justify-between w-full">
                            <Button variant="ghost" onClick={onClose}>Cancel</Button>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setStep('refine')}>Skip to Manual</Button>
                                <Button
                                    onClick={handleAnalyze}
                                    disabled={!formData.content || formData.content.length < 20 || isAnalyzing}
                                    className="bg-brand hover:bg-brand/90 text-white"
                                >
                                    {isAnalyzing ? (
                                        <>Analyzing...</>
                                    ) : (
                                        <>
                                            <MagicWand size={16} className="mr-2" />
                                            Analyze with AI
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    ) : step === 'refine' ? (
                        <div className="flex justify-between w-full">
                            <Button variant="ghost" onClick={() => setStep('draft')}>
                                <ArrowLeft size={16} className="mr-2" /> Back to Draft
                            </Button>
                            <Button onClick={() => setStep('meta')}>
                                Next: Finalize <ArrowRight size={16} className="ml-2" />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex justify-between w-full">
                            <Button variant="ghost" onClick={() => setStep('refine')}>
                                <ArrowLeft size={16} className="mr-2" /> Back to Refine
                            </Button>
                            <Button onClick={handleSave}>
                                <FloppyDisk size={16} className="mr-2" /> Save Story
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

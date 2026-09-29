"use client";

import { useState, useEffect } from "react";
import { StarStory } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogBody,
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
import { ArrowRight, ArrowLeft, Check, FloppyDisk } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { COMMON_QUESTIONS } from "@/lib/interview-questions";

interface StoryEditorWizardProps {
    isOpen: boolean;
    onClose: () => void;
    story?: StarStory | null;
    onSave: (story: StarStory) => void;
}

type WizardStep = 'refine' | 'meta';

export function StoryEditorWizard({ isOpen, onClose, story, onSave }: StoryEditorWizardProps) {
    const [step, setStep] = useState<WizardStep>('refine');
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
    const [isTitleFocused, setIsTitleFocused] = useState(false);


    // Reset or populate on open
    useEffect(() => {
        if (isOpen) {
            if (story) {
                setFormData({ ...story });
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
                    type: 'star'
                });
            }
            setStep('refine');
        }
    }, [isOpen, story]);

    const handleSave = () => {
        // Ensure required fields
        if (!formData.title) formData.title = "Untitled Story";

        onSave(formData as StarStory);
        onClose();
    };

    const steps = [
        { id: 'refine', label: 'Refine STAR' },
        { id: 'meta', label: 'Finalize' }
    ];

    const currentStepIndex = steps.findIndex(s => s.id === step);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader className="pr-8">
                    <div className="flex items-center justify-between mb-2">
                        <DialogTitle>{story ? 'Edit Story' : 'New STAR Story'}</DialogTitle>
                        {/* Stepper */}
                        <div className="flex items-center gap-2 text-xs">
                            {steps.map((s, i) => (
                                <div key={s.id} className={cn("flex items-center gap-1",
                                    i <= currentStepIndex ? "text-primary" : "text-muted-foreground"
                                )}>
                                    <div className={cn("w-5 h-5 rounded-none flex items-center justify-center border",
                                        i < currentStepIndex ? "bg-primary border-primary text-primary-foreground" :
                                            i === currentStepIndex ? "border-primary text-primary" : "border-muted-foreground"
                                    )}>
                                        {i < currentStepIndex ? <Check weight="bold" /> : i + 1}
                                    </div>
                                    <span className="hidden sm:inline">{s.label}</span>
                                    {i < steps.length - 1 && <div className="w-4 h-px bg-muted-foreground mx-1" />}
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogDescription>
                        {step === 'refine' && "Fill in the structured details. Be specific and quantitative."}
                        {step === 'meta' && "Add final touches to categorize this story."}
                    </DialogDescription>
                </DialogHeader>

                <DialogBody className="py-4 px-1">
                    {step === 'refine' && (
                        <div className="space-y-6">
                            <div className="grid gap-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-semibold text-muted-foreground">Situation</Label>
                                            <span className="text-xs text-muted-foreground">The Setup</span>
                                        </div>
                                        <Textarea
                                            value={formData.situation || ''}
                                            onChange={e => setFormData({ ...formData, situation: e.target.value })}
                                            placeholder="Context and background..."
                                            className="h-28 text-base md:text-sm resize-none bg-muted focus:bg-background transition-colors"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-semibold text-muted-foreground">Task</Label>
                                            <span className="text-xs text-muted-foreground">The Goal</span>
                                        </div>
                                        <Textarea
                                            value={formData.task || ''}
                                            onChange={e => setFormData({ ...formData, task: e.target.value })}
                                            placeholder="Your specific role and goal..."
                                            className="h-28 text-base md:text-sm resize-none bg-muted focus:bg-background transition-colors"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-semibold text-muted-foreground">Action</Label>
                                        <span className="text-xs text-muted-foreground">The Execution (Most Important)</span>
                                    </div>
                                    <Textarea
                                        value={formData.action || ''}
                                        onChange={e => setFormData({ ...formData, action: e.target.value })}
                                        placeholder="What you did (use 'I', not 'We')..."
                                        className="h-32 text-base md:text-sm resize-none bg-muted focus:bg-background transition-colors"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-semibold text-muted-foreground">Result</Label>
                                        <span className="text-xs text-muted-foreground">The Impact</span>
                                    </div>
                                    <Textarea
                                        value={formData.result || ''}
                                        onChange={e => setFormData({ ...formData, result: e.target.value })}
                                        placeholder="Outcome, metrics, and impact..."
                                        className="h-24 text-base md:text-sm resize-none bg-muted focus:bg-background transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'meta' && (
                        <div className="space-y-6">
                            {/* Question Dropdown */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground">
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
                                        className="bg-muted border-input focus:bg-background focus:border-brand transition-all"
                                    />
                                    {isTitleFocused && (
                                        <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-none max-h-60 overflow-y-auto p-1">
                                            {COMMON_QUESTIONS.filter(q =>
                                                !formData.question || q.toLowerCase().includes(formData.question.toLowerCase())
                                            ).map((q, i) => (
                                                <button
                                                    key={i}
                                                    className="w-full text-left px-3 py-2 text-sm rounded-none hover:bg-muted hover:text-brand transition-colors text-foreground"
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
                                <p className="text-xs text-muted-foreground">
                                    Categorizing your story makes it easier to find later when you're prepping for a specific question.
                                </p>
                            </div>

                            {/* Story Title */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground">
                                    Story Title <span className="text-danger-text">*</span>
                                </Label>
                                <Input
                                    value={formData.title || ''}
                                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="e.g. Critical Bug Fix"
                                    className="text-base font-semibold h-10 border-input"
                                />
                                <p className="text-xs text-muted-foreground">
                                    A short, memorable name for you to reference this story.
                                </p>
                            </div>

                            {/* Importance */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground">
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
                </DialogBody>

                <DialogFooter className="border-t pt-4">
                    {step === 'refine' ? (
                        <div className="flex justify-between w-full">
                            <Button variant="ghost" onClick={onClose}>Cancel</Button>
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

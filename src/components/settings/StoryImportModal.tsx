"use client";

import { useState, useMemo } from "react";
import { StarStory } from "@/types";
import { ParsedStory, parseStoriesFromText } from "@/actions/parse-stories";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sparkle,
    Check,
    X,
    ArrowRight,
    ArrowLeft,
    Warning,
    Lightning,
    CheckCircle,
    Circle,
    PencilSimple,
    Trash,
    Plus,
    CaretDown,
    CaretUp,
    Tag,
    Brain
} from "@phosphor-icons/react";

interface StoryImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (stories: StarStory[]) => void;
}

type ImportStep = 'input' | 'parsing' | 'review';

import { COMMON_QUESTIONS } from "@/lib/interview-questions";

export function StoryImportModal({ isOpen, onClose, onImport }: StoryImportModalProps) {
    const [step, setStep] = useState<ImportStep>('input');
    const [inputText, setInputText] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [parsedStories, setParsedStories] = useState<ParsedStory[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);

    const resetState = () => {
        setStep('input');
        setInputText("");
        setError(null);
        setParsedStories([]);
        setSelectedIds(new Set());
        setExpandedId(null);
        setWarnings([]);
        setIsProcessing(false);
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleParse = async () => {
        if (!inputText.trim() || inputText.trim().length < 50) {
            setError("Please paste more text. We need at least a few sentences to find stories.");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setStep('parsing');

        try {
            const result = await parseStoriesFromText(inputText);

            if (result.error) {
                throw new Error(result.error);
            }

            if (result.data) {
                setParsedStories(result.data.stories);
                setWarnings(result.data.warnings);
                // Auto-select all stories with confidence >= 60
                const autoSelect = new Set(
                    result.data.stories
                        .filter(s => s.confidence >= 60)
                        .map(s => s.id)
                );
                setSelectedIds(autoSelect);
                setStep('review');
            }
        } catch (e: any) {
            setError(e.message || "Failed to parse stories");
            setStep('input');
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const selectAll = () => {
        setSelectedIds(new Set(parsedStories.map(s => s.id)));
    };

    const deselectAll = () => {
        setSelectedIds(new Set());
    };

    const updateStory = (id: string, updates: Partial<ParsedStory>) => {
        setParsedStories(prev =>
            prev.map(s => s.id === id ? { ...s, ...updates } : s)
        );
    };

    const deleteStory = (id: string) => {
        setParsedStories(prev => prev.filter(s => s.id !== id));
        const newSet = new Set(selectedIds);
        newSet.delete(id);
        setSelectedIds(newSet);
    };

    const handleImport = () => {
        const storiesToImport: StarStory[] = parsedStories
            .filter(s => selectedIds.has(s.id))
            .map(({ confidence, parseNotes, suggestedTags, ...story }) => ({
                ...story,
                id: crypto.randomUUID(), // Generate fresh IDs
                tags: suggestedTags
            }));

        onImport(storiesToImport);
        handleClose();
    };

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return { bg: 'bg-green-500', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800' };
        if (confidence >= 60) return { bg: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800' };
        return { bg: 'bg-red-500', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' };
    };

    const selectedCount = selectedIds.size;
    const totalCount = parsedStories.length;

    // Example prompts to inspire users
    const examplePrompts = [
        "Led a team of 5 engineers to rebuild our payment processing system, reducing transaction failures by 40%...",
        "During the product launch, I identified a critical bug in production and coordinated the fix across 3 teams...",
        "Mentored 2 junior developers who both got promoted within a year. Implemented code review process that..."
    ];

    const renderInputStep = () => (
        <div className="space-y-6">
            {/* Helpful context */}
            <div className="bg-brand/5 border border-brand/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <Brain size={20} weight="duotone" className="text-brand mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">AI will extract your stories</p>
                        <p className="text-xs text-muted-foreground">
                            Paste your experiences, achievements, or even rough notes. The AI will identify individual stories and structure them in STAR format.
                        </p>
                    </div>
                </div>
            </div>

            {/* Main input */}
            <div className="space-y-2">
                <Textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste your experiences here...

Example:
• Led migration of legacy system to microservices
• Resolved critical production incident saving $50K
• Built feature that increased user engagement 25%
• Mentored 3 junior engineers..."
                    className="min-h-[280px] text-sm font-mono resize-none"
                />
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        {inputText.length > 0 && `${inputText.length} characters`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        Tip: More detail = better stories
                    </span>
                </div>
            </div>

            {/* Example chips */}
            <div className="space-y-2">
                <span className="text-xs text-muted-foreground font-medium">Need inspiration? Click to add:</span>
                <div className="flex flex-wrap gap-2">
                    {examplePrompts.map((prompt, idx) => (
                        <button
                            key={idx}
                            onClick={() => setInputText(prev => prev + (prev ? '\n\n' : '') + prompt)}
                            className="text-xs px-3 py-1.5 rounded-full bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
                        >
                            {prompt.substring(0, 40)}...
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                    <Warning size={16} weight="bold" />
                    {error}
                </div>
            )}
        </div>
    );

    const renderParsingStep = () => (
        <div className="py-16 text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-brand/10 flex items-center justify-center mx-auto">
                <Lightning size={40} weight="fill" className="text-brand animate-pulse" />
            </div>
            <div>
                <p className="font-semibold text-lg text-foreground">Analyzing your experiences...</p>
                <p className="text-sm text-muted-foreground mt-1">
                    AI is identifying stories and structuring them
                </p>
            </div>
            <div className="flex justify-center gap-1 pt-4">
                {[0, 1, 2].map(i => (
                    <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-brand animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                    />
                ))}
            </div>
        </div>
    );

    const renderReviewStep = () => (
        <div className="space-y-4 -mx-6">
            {/* Header stats */}
            <div className="px-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-sm">
                        {totalCount} {totalCount === 1 ? 'story' : 'stories'} found
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                        {selectedCount} selected
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={selectAll}
                        className="text-xs text-brand hover:underline"
                    >
                        Select all
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                        onClick={deselectAll}
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        Deselect all
                    </button>
                </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
                <div className="px-6">
                    <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                        <div className="flex items-start gap-2">
                            <Warning size={16} className="text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                            <div className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                                {warnings.map((w, i) => (
                                    <p key={i}>{w}</p>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stories list */}
            <ScrollArea className="h-[380px]">
                <div className="px-6 space-y-3">
                    {parsedStories.map((story) => {
                        const isSelected = selectedIds.has(story.id);
                        const isExpanded = expandedId === story.id;
                        const colors = getConfidenceColor(story.confidence);

                        return (
                            <div
                                key={story.id}
                                className={`border rounded-lg overflow-hidden transition-all ${isSelected
                                    ? 'border-brand/50 bg-brand/5'
                                    : 'border-border bg-background hover:border-border/80'
                                    }`}
                            >
                                {/* Story header */}
                                <div className="p-3 flex items-start gap-3">
                                    {/* Checkbox */}
                                    <button
                                        onClick={() => toggleSelect(story.id)}
                                        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0 ${isSelected
                                            ? 'bg-brand border-brand text-white'
                                            : 'border-border hover:border-brand/50'
                                            }`}
                                    >
                                        {isSelected && <Check size={12} weight="bold" />}
                                    </button>

                                    <div className="flex-1 min-w-0 space-y-4">
                                        <div className="grid gap-4">
                                            {/* Question & Title */}
                                            <div className="space-y-3">
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                                                            Question Answered
                                                        </Label>
                                                        {story.confidence < 70 && (
                                                            <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 animate-pulse">
                                                                <Warning size={10} weight="bold" />
                                                                <span>Needs Details</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="relative group/question">
                                                        <Input
                                                            value={story.question || ''}
                                                            onChange={e => updateStory(story.id, { question: e.target.value })}
                                                            placeholder="e.g. Tell me about a time you handled a difficult conflict..."
                                                            className="h-9 text-sm bg-muted/30 border-transparent focus:border-brand/50 focus:bg-background transition-all hover:bg-muted/50"
                                                        />
                                                        <div className="hidden group-focus-within/question:block absolute z-20 w-full mt-1 bg-popover/95 backdrop-blur-sm border border-border/50 rounded-lg shadow-xl max-h-56 overflow-y-auto p-1">
                                                            {COMMON_QUESTIONS.filter(q =>
                                                                !story.question || q.toLowerCase().includes(story.question.toLowerCase())
                                                            ).map((q, i) => (
                                                                <button
                                                                    key={i}
                                                                    className="w-full text-left px-3 py-2 text-xs rounded-md hover:bg-brand/10 hover:text-brand transition-colors text-foreground/80 truncate"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        updateStory(story.id, { question: q });
                                                                    }}
                                                                >
                                                                    {q}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                                                        Story Title <span className="text-destructive">*</span>
                                                    </Label>
                                                    <Input
                                                        value={story.title || ''}
                                                        onChange={e => updateStory(story.id, { title: e.target.value })}
                                                        placeholder="e.g. Critical DB Migration"
                                                        className={`h-9 text-sm font-semibold bg-background ${!story.title ? 'border-destructive/50 ring-1 ring-destructive/20' : ''}`}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Preview Snippet */}
                                        <div className="bg-muted/30 rounded-md p-3 border border-border/40">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} bg-opacity-10 ${colors.text} ${colors.border}`}>
                                                    <Sparkle size={10} weight="fill" />
                                                    {story.confidence}% Match
                                                </div>
                                                {story.suggestedTags?.slice(0, 3).map((tag, i) => (
                                                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground bg-background">
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed italic">
                                                "{story.situation?.substring(0, 150) || story.content?.substring(0, 150)}..."
                                            </p>
                                        </div>

                                        {/* Parse notes */}
                                        {story.parseNotes && (
                                            <div className="flex items-start gap-2 text-[11px] text-amber-600/90 bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 rounded">
                                                <Warning size={14} className="mt-0.5 shrink-0" />
                                                <span>{story.parseNotes}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-col gap-1 shrink-0 pt-0.5 pl-2 border-l border-border/40 ml-1">
                                        <button
                                            onClick={() => setExpandedId(isExpanded ? null : story.id)}
                                            className={`p-2 rounded-md transition-all ${isExpanded ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
                                            title={isExpanded ? "Collapse details" : "Review full story"}
                                        >
                                            {isExpanded ? <CaretUp size={16} /> : <PencilSimple size={16} />}
                                        </button>
                                        <button
                                            onClick={() => deleteStory(story.id)}
                                            className="p-2 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                                            title="Discard story"
                                        >
                                            <Trash size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded content */}
                                {isExpanded && (
                                    <div className="px-4 pb-4 pt-3 bg-muted/10 border-t border-border/40">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        Situation
                                                    </label>
                                                    <span className="text-[10px] text-muted-foreground/50">Context</span>
                                                </div>
                                                <Textarea
                                                    value={story.situation || ""}
                                                    onChange={(e) => updateStory(story.id, { situation: e.target.value })}
                                                    className="text-xs h-24 resize-none bg-background focus:bg-background border-border/60 focus:border-brand/50"
                                                    placeholder="What was the context or problem?"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        Task
                                                    </label>
                                                    <span className="text-[10px] text-muted-foreground/50">Goal</span>
                                                </div>
                                                <Textarea
                                                    value={story.task || ""}
                                                    onChange={(e) => updateStory(story.id, { task: e.target.value })}
                                                    className="text-xs h-24 resize-none bg-background focus:bg-background border-border/60 focus:border-brand/50"
                                                    placeholder="What was your specific responsibility?"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        Action
                                                    </label>
                                                    <span className="text-[10px] text-muted-foreground/50">Steps</span>
                                                </div>
                                                <Textarea
                                                    value={story.action || ""}
                                                    onChange={(e) => updateStory(story.id, { action: e.target.value })}
                                                    className="text-xs h-24 resize-none bg-background focus:bg-background border-border/60 focus:border-brand/50"
                                                    placeholder="What visible actions did you take?"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        Result
                                                    </label>
                                                    <span className="text-[10px] text-muted-foreground/50">Outcome</span>
                                                </div>
                                                <Textarea
                                                    value={story.result || ""}
                                                    onChange={(e) => updateStory(story.id, { result: e.target.value })}
                                                    className="text-xs h-24 resize-none bg-background focus:bg-background border-border/60 focus:border-brand/50"
                                                    placeholder="What was the measurable outcome?"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {parsedStories.length === 0 && (
                        <div className="text-center py-12">
                            <p className="text-muted-foreground">No stories found in the text.</p>
                            <Button
                                variant="link"
                                onClick={() => setStep('input')}
                                className="mt-2"
                            >
                                Try again with different text
                            </Button>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[640px] bg-white dark:bg-neutral-950 max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader className="pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                            <Sparkle size={18} weight="fill" className="text-brand" />
                        </div>
                        {step === 'input' && "Import Stories"}
                        {step === 'parsing' && "Analyzing..."}
                        {step === 'review' && "Review Stories"}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'input' && "Paste your experiences and AI will extract structured STAR stories"}
                        {step === 'parsing' && "Finding and structuring your stories..."}
                        {step === 'review' && "Select stories to add to your library"}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden py-4">
                    {step === 'input' && renderInputStep()}
                    {step === 'parsing' && renderParsingStep()}
                    {step === 'review' && renderReviewStep()}
                </div>

                <div className="flex justify-between gap-3 pt-4 border-t">
                    {step === 'review' ? (
                        <>
                            <Button variant="outline" onClick={() => setStep('input')}>
                                <ArrowLeft size={16} className="mr-2" />
                                Back
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={selectedCount === 0 || parsedStories.some(s => selectedIds.has(s.id) && !s.title)}
                                title={parsedStories.some(s => selectedIds.has(s.id) && !s.title) ? "All selected stories must have a title" : ""}
                            >
                                <Plus size={16} className="mr-2" />
                                Import {selectedCount} {selectedCount === 1 ? 'Story' : 'Stories'}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
                                Cancel
                            </Button>
                            <Button onClick={handleParse} disabled={!inputText.trim() || inputText.trim().length < 50 || isProcessing}>
                                {isProcessing ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                                        Parsing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkle size={16} weight="fill" className="mr-2" />
                                        Find Stories
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

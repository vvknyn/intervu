"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MagicWand, Check } from "@phosphor-icons/react";
import { convertBlobToStar } from "@/actions/parse-stories";
import { StarStory } from "@/types";
import { COMPLETION } from "@/lib/copy";

interface AddStoryStepProps {
    onSave: (story: StarStory) => void;
    onValidityChange?: (valid: boolean) => void;
}

export function AddStoryStep({ onSave, onValidityChange }: AddStoryStepProps) {
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyzeAndSave = async () => {
        if (!content || content.trim().length < 20) return;
        setIsAnalyzing(true);
        setError(null);

        try {
            const result = await convertBlobToStar(content, title || "My Story");
            const story: StarStory = {
                id: crypto.randomUUID(),
                title: title || "My Story",
                content,
                situation: result.data?.situation || "",
                task: result.data?.task || "",
                action: result.data?.action || "",
                result: result.data?.result || "",
                importance: "medium",
                type: "star",
            };
            onSave(story);
            setSaved(true);
            onValidityChange?.(true);
        } catch (e) {
            setError("Analysis failed. The story was not saved.");
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSaveRaw = () => {
        const story: StarStory = {
            id: crypto.randomUUID(),
            title: title || "My Story",
            content,
            situation: "",
            task: "",
            action: "",
            result: "",
            importance: "medium",
            type: "blob",
        };
        onSave(story);
        setSaved(true);
        onValidityChange?.(true);
    };

    if (saved) {
        return (
            <div className="text-center py-8 space-y-3 animate-in fade-in">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                    <Check size={24} weight="bold" className="text-green-600" />
                </div>
                <p className="font-medium">{COMPLETION.storySaved}</p>
                <p className="text-sm text-muted-foreground">{COMPLETION.storySavedSub}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-in fade-in">
            <p className="text-sm text-muted-foreground">
                Share a professional accomplishment. The AI will structure it into Situation, Task, Action, Result format.
            </p>

            <div className="space-y-1.5">
                <Label htmlFor="story-title" className="text-xs">Title (optional)</Label>
                <Input
                    id="story-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Led Database Migration"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="story-content" className="text-xs">Your Story</Label>
                    <span className="text-[10px] text-muted-foreground">{content.length} chars</span>
                </div>
                <Textarea
                    id="story-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={"Dump your thoughts here. Don't worry about structure.\n\nExample: I led a project to migrate our database from MySQL to PostgreSQL. We had 50M records and needed zero downtime..."}
                    className="min-h-[180px] text-sm resize-none font-mono"
                />
                {content.length > 0 && content.length < 20 && (
                    <p className="text-[10px] text-muted-foreground">Need at least 20 characters for AI analysis</p>
                )}
            </div>

            {error && (
                <p className="text-xs text-destructive">{error}</p>
            )}

            <div className="flex gap-2">
                <Button
                    variant="outline"
                    onClick={handleSaveRaw}
                    disabled={!content.trim() || isAnalyzing}
                    className="flex-1"
                >
                    Save as Draft
                </Button>
                <Button
                    onClick={handleAnalyzeAndSave}
                    disabled={!content || content.trim().length < 20 || isAnalyzing}
                    className="flex-1 bg-brand hover:bg-brand/90 text-white"
                >
                    {isAnalyzing ? (
                        "Analyzing..."
                    ) : (
                        <>
                            <MagicWand size={16} className="mr-2" />
                            Analyze with AI
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StoryEditorWizard } from "@/components/dashboard/StoryEditorWizard";
import { StarStory } from "@/types";
import { saveStories } from "@/actions/save-story";
import { Plus, Check, BookOpen } from "@phosphor-icons/react";
import { EMPTY_STORIES, COMPLETION } from "@/lib/copy";

interface StoryBankRecipeWizardProps {
    isOpen: boolean;
    onClose: () => void;
    stories: StarStory[];
    onStoriesChange: (stories: StarStory[]) => void;
}

export function StoryBankRecipeWizard({
    isOpen,
    onClose,
    stories,
    onStoriesChange,
}: StoryBankRecipeWizardProps) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [addedCount, setAddedCount] = useState(0);
    const [showPrompt, setShowPrompt] = useState(false);

    const handleSave = async (story: StarStory) => {
        const updated = [...stories, story];
        onStoriesChange(updated);
        setAddedCount((c) => c + 1);
        setShowPrompt(true);
        try {
            await saveStories(updated);
        } catch (e) {
            console.error("Failed to save stories:", e);
        }
    };

    const handleAddAnother = () => {
        setShowPrompt(false);
        setEditorOpen(true);
    };

    const handleDone = () => {
        setAddedCount(0);
        setShowPrompt(false);
        onClose();
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            handleDone();
        }
    };

    // If the editor is open, show StoryEditorWizard
    if (editorOpen) {
        return (
            <StoryEditorWizard
                isOpen={true}
                onClose={() => {
                    setEditorOpen(false);
                    // If they close without saving, show the prompt page
                    if (!showPrompt) {
                        setShowPrompt(false);
                    }
                }}
                onSave={(story) => {
                    handleSave(story);
                    setEditorOpen(false);
                }}
            />
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookOpen size={20} weight="duotone" className="text-amber-600" />
                        Build Your Story Bank
                    </DialogTitle>
                    <DialogDescription>
                        STAR stories help you ace behavioral interviews. Add your top accomplishments.
                    </DialogDescription>
                </DialogHeader>

                {showPrompt ? (
                    <div className="text-center py-6 space-y-4 animate-in fade-in">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                            <Check size={24} weight="bold" className="text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium">{COMPLETION.storySaved}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                You&apos;ve added {addedCount} {addedCount === 1 ? "story" : "stories"} this session.
                                {stories.length > 0 && (
                                    <span className="block text-xs mt-0.5">
                                        {stories.length} total in your bank.
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center justify-center gap-3">
                            <Button variant="outline" onClick={handleDone}>
                                Done
                            </Button>
                            <Button onClick={handleAddAnother}>
                                <Plus size={16} className="mr-1" />
                                Add Another
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-6 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {EMPTY_STORIES.prompt}
                        </p>
                        {stories.length > 0 && (
                            <p className="text-xs text-muted-foreground/60">
                                You have {stories.length} {stories.length === 1 ? "story" : "stories"} in your bank.
                            </p>
                        )}
                        <div className="flex items-center justify-center gap-3">
                            <Button variant="outline" onClick={handleDone}>
                                Cancel
                            </Button>
                            <Button onClick={() => setEditorOpen(true)}>
                                <Plus size={16} className="mr-1" />
                                Add Story
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

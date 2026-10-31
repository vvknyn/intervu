"use client";

import { useState } from "react";
import { StarStory } from "@/types";
import { StoryList } from "@/components/dashboard/StoryList";
import { StoryEditorWizard } from "@/components/dashboard/StoryEditorWizard";
import { Button } from "@/components/ui/button";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, DownloadSimple } from "@phosphor-icons/react";
import { exportStoriesToText } from "@/lib/export-utils";

interface StoryManagerProps {
    stories: StarStory[];
    onChange: (stories: StarStory[]) => void;
}

export function StoryManager({ stories, onChange }: StoryManagerProps) {
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [editingStory, setEditingStory] = useState<StarStory | null>(null);

    const handleCreate = () => {
        setEditingStory(null);
        setIsWizardOpen(true);
    };

    const handleEdit = (story: StarStory) => {
        setEditingStory(story);
        setIsWizardOpen(true);
    };

    const handleDelete = (id: string) => {
        // Mark as deleted instead of removing, so we can persist the deletion
        const updatedStories = stories.map(s =>
            s.id === id ? { ...s, deleted: true } : s
        );
        onChange(updatedStories);
    };

    const handleSaveStory = (story: StarStory) => {
        const index = stories.findIndex(s => s.id === story.id);
        if (index >= 0) {
            const newStories = [...stories];
            newStories[index] = story;
            onChange(newStories);
        } else {
            onChange([...stories, story]);
        }
        setIsWizardOpen(false);
    };

    const handleExport = () => {
        const activeStories = stories.filter(s => !s.deleted);
        exportStoriesToText(activeStories);
    };

    const activeStories = stories.filter(s => !s.deleted);

    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

    const handleClearAll = () => {
        // Mark all active stories as deleted
        const updatedStories = stories.map(s =>
            !s.deleted ? { ...s, deleted: true } : s
        );
        onChange(updatedStories);
        setClearConfirmOpen(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-muted p-4 rounded-panel border border-border">
                <div>
                    <h3 className="font-semibold text-foreground">Your Career Stories</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        {activeStories.length} {activeStories.length === 1 ? 'story' : 'stories'} saved
                    </p>
                </div>
                <div className="flex gap-2">
                    {activeStories.length > 0 && (
                        <Button
                            onClick={() => setClearConfirmOpen(true)}
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-danger-text hover:bg-muted"
                        >
                            Clear All
                        </Button>
                    )}
                    <Button
                        onClick={handleExport}
                        variant="outline"
                        size="sm"
                        disabled={activeStories.length === 0}
                    >
                        <DownloadSimple className="mr-2" /> Export
                    </Button>
                    <Button
                        onClick={handleCreate}
                        size="sm"
                    >
                        <Plus className="mr-2" /> New Story
                    </Button>
                </div>
            </div>

            <StoryList
                stories={activeStories}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            {/* Wizard Modal for Creating/Editing */}
            <StoryEditorWizard
                isOpen={isWizardOpen}
                onClose={() => setIsWizardOpen(false)}
                story={editingStory}
                onSave={handleSaveStory}
            />

            {/* Clear All Confirmation Dialog */}
            <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Clear All Stories?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove all your stories? This action will move them to trash.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={handleClearAll}>
                            Clear All
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

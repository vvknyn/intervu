"use client";

import { useState } from "react";
import { StarStory } from "@/types";
import { StoryList } from "@/components/dashboard/StoryList";
import { StoryEditorWizard } from "@/components/dashboard/StoryEditorWizard";
import { Button } from "@/components/ui/button";
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
            <div className="flex justify-between items-center bg-muted/20 p-4 rounded-lg border border-border">
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
                            className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                            Clear All
                        </Button>
                    )}
                    <Button
                        onClick={handleExport}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        disabled={activeStories.length === 0}
                    >
                        <DownloadSimple size={14} className="mr-2" /> Export
                    </Button>
                    <Button
                        onClick={handleCreate}
                        size="sm"
                        className="text-xs"
                    >
                        <Plus size={14} className="mr-2" /> New Story
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
            {clearConfirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-background rounded-lg max-w-sm w-full p-6 border border-border">
                        <h3 className="text-lg font-semibold mb-2">Clear All Stories?</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            Are you sure you want to remove all your stories? This action will move them to trash.
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>
                                Cancel
                            </Button>
                            <Button variant="destructive" onClick={handleClearAll}>
                                Clear All
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

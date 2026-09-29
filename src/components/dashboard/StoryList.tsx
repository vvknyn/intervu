import { StarStory } from "@/types";
import { Button } from "@/components/ui/button";
import { PencilSimple, Trash, CaretUp, CaretDown, Star, DotsThreeVertical } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StoryListProps {
    stories: StarStory[];
    onEdit: (story: StarStory) => void;
    onDelete: (id: string) => void;
}

export function StoryList({ stories, onEdit, onDelete }: StoryListProps) {
    // Sort stories: High importance first, then Medium, then Low, then others. Within importance, sort by creation (assuming new ones added to end, but we don't have date field, so index order)
    // Actually, let's just sort by importance score
    const importanceScore = (importance?: string) => {
        switch (importance) {
            case 'high': return 3;
            case 'medium': return 2;
            case 'low': return 1;
            default: return 0;
        }
    };

    const sortedStories = [...stories].sort((a, b) => {
        const scoreA = importanceScore(a.importance);
        const scoreB = importanceScore(b.importance);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return 0; // Keep original order if importance is same
    });

    const getImportanceLabel = (importance?: string) => {
        switch (importance) {
            case 'high':
                return <span className="text-xs font-semibold text-warn">High</span>;
            case 'medium':
                return <span className="text-xs font-semibold text-warn">Med</span>;
            case 'low':
                return <span className="text-xs font-semibold text-muted-foreground">Low</span>;
            default:
                return null;
        }
    };

    if (sortedStories.length === 0) {
        return (
            <div className="text-center py-12 border border-border rounded-none">
                <p className="text-muted-foreground text-sm">No stories added yet.</p>
                <p className="text-muted-foreground text-xs mt-1">Add stories manually or import them with AI</p>
            </div>
        );
    }

    return (
        <div className="border border-border rounded-none bg-background overflow-hidden">
            {sortedStories.map((story, index) => (
                <div
                    key={story.id}
                    className={cn(
                        "group flex items-center gap-3 p-3 transition-colors hover:bg-muted",
                        index !== sortedStories.length - 1 && "border-b border-border"
                    )}
                >
                    {/* Rank / Index */}
                    <div className="text-muted-foreground text-sm w-6 text-right shrink-0">
                        {index + 1}.
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                        {/* Title & Question */}
                        <div className="min-w-0 flex flex-col gap-0.5" onClick={() => onEdit(story)}>
                            {story.question && (
                                <div className="text-xs text-muted-foreground truncate max-w-[400px]">
                                    {story.question}
                                </div>
                            )}
                            <div className="text-sm text-foreground truncate cursor-pointer hover:underline decoration-muted-foreground underline-offset-4">
                                {story.title || "Untitled Story"}
                            </div>
                        </div>

                        {/* Metadata/Badges */}
                        <div className="flex items-center gap-2 shrink-0">
                            {getImportanceLabel(story.importance)}

                            {story.type === 'blob' && (
                                <span className="text-xs font-semibold text-muted-foreground">Draft</span>
                            )}
                        </div>

                        {/* Preview (Desktop only) */}
                        <div className="hidden sm:block text-xs text-muted-foreground truncate max-w-[300px]">
                            {story.situation || story.content || "No content"}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                            onClick={() => onEdit(story)}
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            title="Edit"
                        >
                            <PencilSimple size={16} />
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                                    <DotsThreeVertical size={16} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onEdit(story)}>
                                    Edit Story
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onDelete(story.id)} className="text-danger-text focus:text-danger-text">
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            ))}
        </div>
    );
}

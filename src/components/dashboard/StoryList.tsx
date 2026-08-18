import { StarStory } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

    const getImportanceBadge = (importance?: string) => {
        switch (importance) {
            case 'high':
                return <Badge variant="default" className="bg-orange-500 hover:bg-orange-600 text-white border-none h-5 px-1.5 text-[10px]">High</Badge>;
            case 'medium':
                return <Badge variant="secondary" className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-none h-5 px-1.5 text-[10px]">Med</Badge>;
            case 'low':
                return <Badge variant="outline" className="text-muted-foreground border-border h-5 px-1.5 text-[10px]">Low</Badge>;
            default:
                return null;
        }
    };

    if (sortedStories.length === 0) {
        return (
            <div className="text-center py-12 border border-dashed border-border rounded-lg">
                <p className="text-muted-foreground text-sm">No stories added yet.</p>
                <p className="text-muted-foreground/70 text-xs mt-1">Add stories manually or import them with AI</p>
            </div>
        );
    }

    return (
        <div className="border border-border rounded-lg bg-background overflow-hidden">
            {sortedStories.map((story, index) => (
                <div
                    key={story.id}
                    className={cn(
                        "group flex items-center gap-3 p-3 transition-colors hover:bg-muted/30",
                        index !== sortedStories.length - 1 && "border-b border-border/50"
                    )}
                >
                    {/* Rank / Index */}
                    <div className="text-muted-foreground/40 text-sm w-6 text-right shrink-0">
                        {index + 1}.
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                        {/* Title & Question */}
                        <div className="min-w-0 flex flex-col gap-0.5" onClick={() => onEdit(story)}>
                            {story.question && (
                                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider truncate max-w-[400px]">
                                    {story.question}
                                </div>
                            )}
                            <div className="font-medium text-sm text-foreground truncate cursor-pointer hover:underline decoration-muted-foreground/50 underline-offset-4">
                                {story.title || "Untitled Story"}
                            </div>
                        </div>

                        {/* Metadata/Badges */}
                        <div className="flex items-center gap-2 shrink-0">
                            {getImportanceBadge(story.importance)}

                            {story.type === 'blob' && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Draft</Badge>
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
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Edit"
                        >
                            <PencilSimple size={16} />
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                    <DotsThreeVertical size={16} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onEdit(story)}>
                                    Edit Story
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onDelete(story.id)} className="text-destructive focus:text-destructive">
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

"use client";

import { useState, useEffect } from "react";
import { Star, Trash, NotePencil, CircleNotch, ChatCircleDots } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchFavorites, removeFavorite, updateFavoriteNotes, FavoriteQuestion } from "@/actions/favorites";
import { DashboardSection } from "./DashboardSection";

interface StarredQuestionsSectionProps {
    isLoggedIn: boolean;
}

export function StarredQuestionsSection({ isLoggedIn }: StarredQuestionsSectionProps) {
    const [favorites, setFavorites] = useState<FavoriteQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editNotes, setEditNotes] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);

    useEffect(() => {
        if (isLoggedIn) {
            loadFavorites();
        } else {
            setLoading(false);
        }
    }, [isLoggedIn]);

    const loadFavorites = async () => {
        setLoading(true);
        const { data, error } = await fetchFavorites();
        if (!error && data) {
            setFavorites(data);
        }
        setLoading(false);
    };

    const handleRemove = async (id: string) => {
        const { error } = await removeFavorite(id);
        if (!error) {
            setFavorites(favorites.filter(f => f.id !== id));
        }
    };

    const handleEditNotes = (favorite: FavoriteQuestion) => {
        setEditingId(favorite.id);
        setEditNotes(favorite.notes || "");
    };

    const handleSaveNotes = async (id: string) => {
        setSavingNotes(true);
        const { error } = await updateFavoriteNotes(id, editNotes);
        if (!error) {
            setFavorites(favorites.map(f =>
                f.id === id ? { ...f, notes: editNotes } : f
            ));
            setEditingId(null);
        }
        setSavingNotes(false);
    };

    if (!isLoggedIn) {
        return (
            <DashboardSection title="Starred Questions" subtitle="Save questions for later review" icon={Star}>
                <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-4">
                        <Star size={32} className="text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">Log in to star questions</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        Sign in to save your favorite questions across sessions
                    </p>
                </div>
            </DashboardSection>
        );
    }

    return (
        <DashboardSection
            title="Starred Questions"
            subtitle={`${favorites.length} ${favorites.length === 1 ? 'question' : 'questions'} saved`}
            icon={Star}
        >
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <CircleNotch size={32} className="animate-spin text-muted-foreground" />
                </div>
            ) : favorites.length === 0 ? (
                <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-4">
                        <ChatCircleDots size={32} className="text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">No starred questions yet</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        Click the star icon next to any question to save it here for quick reference
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {favorites.map((favorite) => (
                        <div
                            key={favorite.id}
                            className="group bg-muted/10 hover:bg-muted/20 border border-border/40 rounded-xl p-4 transition-all"
                        >
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex-1">
                                    <p className="text-sm font-medium leading-relaxed">{favorite.question_text}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => handleEditNotes(favorite)}
                                        title="Edit notes"
                                    >
                                        <NotePencil size={16} />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                                        onClick={() => handleRemove(favorite.id)}
                                        title="Remove from starred"
                                    >
                                        <Trash size={16} />
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2 mb-3">
                                {favorite.question_category && (
                                    <Badge variant="secondary" className="text-xs">
                                        {favorite.question_category}
                                    </Badge>
                                )}
                                {favorite.company && (
                                    <Badge variant="outline" className="text-xs">
                                        {favorite.company}
                                    </Badge>
                                )}
                                {favorite.position && (
                                    <Badge variant="outline" className="text-xs">
                                        {favorite.position}
                                    </Badge>
                                )}
                                {favorite.round && (
                                    <Badge variant="outline" className="text-xs">
                                        {favorite.round}
                                    </Badge>
                                )}
                            </div>

                            {editingId === favorite.id ? (
                                <div className="mt-3 space-y-2">
                                    <Textarea
                                        value={editNotes}
                                        onChange={(e) => setEditNotes(e.target.value)}
                                        placeholder="Add your notes, tips, or answer ideas..."
                                        className="text-sm min-h-[80px] resize-none"
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() => handleSaveNotes(favorite.id)}
                                            disabled={savingNotes}
                                            className="text-xs"
                                        >
                                            {savingNotes ? (
                                                <>
                                                    <CircleNotch size={14} className="animate-spin mr-1" />
                                                    Saving...
                                                </>
                                            ) : (
                                                "Save"
                                            )}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setEditingId(null)}
                                            className="text-xs"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : favorite.notes ? (
                                <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/30">
                                    <p className="text-xs text-muted-foreground italic">{favorite.notes}</p>
                                </div>
                            ) : (
                                <button
                                    onClick={() => handleEditNotes(favorite)}
                                    className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    + Add notes
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </DashboardSection>
    );
}

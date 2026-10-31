"use client";

import { useState, useEffect } from "react";
import { Star, X, Trash, NotePencil, ChatCircleDots } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fetchFavorites, removeFavorite, updateFavoriteNotes, FavoriteQuestion } from "@/actions/favorites";
import { cn } from "@/lib/utils";

interface FavoritesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function FavoritesModal({ isOpen, onClose }: FavoritesModalProps) {
    const [favorites, setFavorites] = useState<FavoriteQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editNotes, setEditNotes] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadFavorites();
        }
    }, [isOpen]);

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

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent showCloseButton={false} className="gap-0 rounded-none bg-card p-0 sm:max-w-3xl">
                    {/* Header */}
                    <div className="p-6 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-none bg-muted flex items-center justify-center">
                                <Star size={20} weight="fill" className="text-warn" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl">Favorite Questions</DialogTitle>
                                <DialogDescription>
                                    {favorites.length} {favorites.length === 1 ? 'question' : 'questions'} saved
                                </DialogDescription>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X size={20} />
                        </Button>
                    </div>

                    {/* Content */}
                    <DialogBody className="p-6">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <InlineSpinner size={24} className="text-muted-foreground" />
                            </div>
                        ) : favorites.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="w-16 h-16 rounded-none bg-muted flex items-center justify-center mx-auto mb-4">
                                    <ChatCircleDots size={24} className="text-muted-foreground" />
                                </div>
                                <h3 className="text-xl mb-2">No favorites yet</h3>
                                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                    Click the star icon next to any question to save it here for quick reference
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {favorites.map((favorite) => (
                                    <div
                                        key={favorite.id}
                                        className="group bg-muted hover:bg-muted border border-border rounded-panel p-4 transition-all"
                                    >
                                        {/* Question Header */}
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <div className="flex-1">
                                                <p className="text-sm leading-relaxed">{favorite.question_text}</p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => handleEditNotes(favorite)}
                                                    title="Edit notes"
                                                >
                                                    <NotePencil size={16} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                                                    onClick={() => handleRemove(favorite.id)}
                                                    title="Remove from favorites"
                                                >
                                                    <Trash size={16} />
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Metadata Tags */}
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

                                        {/* Notes Section */}
                                        {editingId === favorite.id ? (
                                            <div className="mt-3 space-y-2">
                                                <Textarea
                                                    value={editNotes}
                                                    onChange={(e) => setEditNotes(e.target.value)}
                                                    placeholder="Add your notes, tips, or answer ideas..."
                                                    className="text-base md:text-sm min-h-[80px] resize-none"
                                                />
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleSaveNotes(favorite.id)}
                                                        disabled={savingNotes}
                                                    >
                                                        {savingNotes ? (
                                                            <>
                                                                <InlineSpinner className="mr-1" />
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
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : favorite.notes ? (
                                            <div className="mt-3 p-3 bg-muted rounded-panel border border-border">
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
                    </DialogBody>
            </DialogContent>
        </Dialog>
    );
}

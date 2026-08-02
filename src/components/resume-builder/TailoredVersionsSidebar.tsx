"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TailoredResumeVersion } from "@/types/resume";
import {
    fetchTailoredVersions,
    deleteTailoredVersion,
    updateVersionName
} from "@/actions/tailor-resume";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Trash,
    Check,
    X,
    Sparkle,
    CircleNotch,
    ArrowLeft,
    PencilSimple
} from "@phosphor-icons/react";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";

interface TailoredVersionsSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    currentVersionId?: string; // Currently viewed version
    applicationId?: string;
    isNewApplication?: boolean;
}

type ViewState = 'list' | 'create';

export function TailoredVersionsSidebar({ isOpen, onClose, currentVersionId, isNewApplication }: TailoredVersionsSidebarProps) {
    const [view, setView] = useState<ViewState>('list');
    const [versions, setVersions] = useState<TailoredResumeVersion[]>([]);

    // Auto-switch to the handoff view for new applications — there's no AI
    // form to prefill anymore, just the note pointing at MCP.
    useEffect(() => {
        if (isNewApplication) {
            setView('create');
        }
    }, [isNewApplication]);

    const [loading, setLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadVersions();
        }
    }, [isOpen]);

    useEffect(() => {
        const handler = () => loadVersions();
        window.addEventListener('version-updated', handler);
        return () => window.removeEventListener('version-updated', handler);
    }, []);

    const loadVersions = async () => {
        setLoading(true);
        const { data, error } = await fetchTailoredVersions();
        if (!error && data) {
            setVersions(data);
        }
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        const { error } = await deleteTailoredVersion(id);
        if (!error) {
            setVersions(versions.filter(v => v.id !== id));
            setDeleteConfirm(null);
            window.dispatchEvent(new Event('version-updated'));
        }
        setDeletingId(null);
    };

    // Just close without resetting state
    const handleClose = () => {
        onClose();
    };

    const handleBack = () => {
        setView('list');
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop - just close, don't reset state */}
            <div
                className="fixed inset-0 bg-black/30 z-[60] animate-in fade-in duration-200"
                onClick={handleClose}
            />

            {/* Sidebar */}
            <div className="fixed inset-y-0 right-0 w-full sm:w-[560px] bg-white dark:bg-zinc-950 border-l border-border shadow-2xl z-[70] flex flex-col animate-in slide-in-from-right-full duration-300">
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        {view !== 'list' && (
                            <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8 -ml-2">
                                <ArrowLeft size={16} />
                            </Button>
                        )}
                        <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                            <Sparkle size={16} weight="fill" className="text-brand" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm">
                                {view === 'list' && 'Tailored Versions'}
                                {view === 'create' && 'Create New Version'}
                            </h3>
                            {view === 'list' && (
                                <p className="text-xs text-muted-foreground">{versions.length} saved</p>
                            )}
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
                        <X size={16} />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                    {/* List View */}
                    {view === 'list' && (
                        <div className="p-4 space-y-3">
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <CircleNotch size={32} className="animate-spin text-muted-foreground" />
                                </div>
                            ) : versions.length === 0 ? (
                                <div className="py-12 text-center text-muted-foreground">
                                    <Sparkle size={32} className="mx-auto mb-3 text-muted-foreground/30" />
                                    <p className="text-sm font-medium text-foreground">No versions yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">Save a snapshot from the toolbar to see it here.</p>
                                </div>
                            ) : (
                                versions.map((version) => (
                                    <VersionCard
                                        key={version.id}
                                        version={version}
                                        isActive={version.id === currentVersionId}
                                        deleteConfirm={deleteConfirm}
                                        deletingId={deletingId}
                                        onDelete={handleDelete}
                                        onDeleteConfirm={setDeleteConfirm}
                                        onClose={onClose}
                                        onVersionUpdated={loadVersions}
                                    />
                                ))
                            )}
                        </div>
                    )}

                    {/* Create View — tailoring now happens via the user's own AI (MCP) */}
                    {view === 'create' && (
                        <div className="p-4">
                            <McpHandoffNote />
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                {view === 'list' && (
                    <div className="p-4 border-t border-border shrink-0">
                        <Button
                            variant="outline"
                            className="w-full"
                            size="sm"
                            onClick={() => setView('create')}
                        >
                            <Sparkle size={14} weight="fill" className="mr-2" />
                            Create New Version
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

function VersionCard({ version, isActive, deleteConfirm, deletingId, onDelete, onDeleteConfirm, onClose, onVersionUpdated }: {
    version: TailoredResumeVersion;
    isActive?: boolean;
    deleteConfirm: string | null;
    deletingId: string | null;
    onDelete: (id: string) => void;
    onDeleteConfirm: (id: string | null) => void;
    onClose: () => void;
    onVersionUpdated?: () => void;
}) {
    const router = useRouter();
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(version.versionName);
    const [isSaving, setIsSaving] = useState(false);

    // Determine if this is a snapshot (manual save) vs tailored (job-specific)
    const isSnapshot = !version.jobPosting || version.companyName === "Snapshot" || version.companyName === "Manual Save";

    const handleCardClick = () => {
        if (isEditing) return; // Don't navigate while editing
        router.push(`/resume-builder?versionId=${version.id}`);
        onClose();
    };

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditName(version.versionName);
        setIsEditing(true);
    };

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(false);
        setEditName(version.versionName);
    };

    const handleSaveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!version.id || !editName.trim()) return;

        setIsSaving(true);
        const { error } = await updateVersionName(version.id, editName.trim());
        setIsSaving(false);

        if (!error) {
            setIsEditing(false);
            onVersionUpdated?.();
            window.dispatchEvent(new Event('version-updated'));
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit(e as any);
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(version.versionName);
        }
    };

    return (
        <div
            className={`group rounded-lg p-3 transition-all ${isEditing ? '' : 'cursor-pointer'} ${isActive
                ? 'bg-brand/10 border-2 border-brand/50 shadow-sm'
                : 'bg-muted/10 hover:bg-muted/20 border border-border/40'
                }`}
            onClick={handleCardClick}
        >
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                    {isEditing ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="h-7 text-sm"
                                autoFocus
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={handleSaveEdit}
                                disabled={isSaving || !editName.trim()}
                            >
                                {isSaving ? (
                                    <CircleNotch size={14} className="animate-spin" />
                                ) : (
                                    <Check size={14} className="text-green-600" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={handleCancelEdit}
                                disabled={isSaving}
                            >
                                <X size={14} />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-medium truncate">{version.versionName}</h4>
                            {/* Version Type Badge */}
                            <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 h-4 ${isSnapshot
                                    ? 'border-blue-300 text-blue-600 bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:bg-blue-950/50'
                                    : 'border-amber-300 text-amber-600 bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:bg-amber-950/50'
                                    }`}
                            >
                                {isSnapshot ? "Snapshot" : "Tailored"}
                            </Badge>
                            {isActive && (
                                <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 bg-brand/80">
                                    Active
                                </Badge>
                            )}
                        </div>
                    )}
                    {!isEditing && !isSnapshot && version.companyName && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{version.companyName}</p>
                    )}
                    {!isEditing && isSnapshot && version.positionTitle && version.positionTitle !== "Resume snapshot" && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5 italic">{version.positionTitle}</p>
                    )}
                </div>
                {!isEditing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {/* Edit Button */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleEditClick}
                            title="Edit version name"
                        >
                            <PencilSimple size={14} />
                        </Button>
                        {/* Delete Button */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!version.id) return;
                                if (deleteConfirm === version.id) {
                                    onDelete(version.id);
                                } else {
                                    onDeleteConfirm(version.id);
                                }
                            }}
                        >
                            {deletingId === version.id ? (
                                <CircleNotch size={14} className="animate-spin" />
                            ) : deleteConfirm === version.id ? (
                                <Check size={14} className="text-destructive" />
                            ) : (
                                <Trash size={14} />
                            )}
                        </Button>
                    </div>
                )}
            </div>
            {!isEditing && (
                <div className="flex items-center gap-2">
                    {!isSnapshot && version.positionTitle && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                            {version.positionTitle}
                        </Badge>
                    )}
                    {version.appliedAt && (
                        <span className="text-[10px] text-muted-foreground">
                            {new Date(version.appliedAt).toLocaleDateString()}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

interface TailoredVersionsToggleProps {
    isOpen: boolean;
    onToggle: () => void;
    count: number;
}

export function TailoredVersionsToggle({ isOpen, onToggle, count }: TailoredVersionsToggleProps) {
    return (
        <button
            onClick={onToggle}
            className={`group inline-flex items-center h-9 px-2.5 rounded-md border transition-all duration-200 ${isOpen
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border hover:border-brand/50 hover:bg-brand/5'
                }`}
        >
            <Sparkle size={16} weight="fill" className={isOpen ? 'text-brand' : 'text-muted-foreground group-hover:text-brand'} />
            <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium pl-1.5">
                    Versions
                </span>
            </span>
            {count > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold bg-brand/20 text-brand px-1.5 py-0.5 rounded-full">
                    {count}
                </span>
            )}
        </button>
    );
}

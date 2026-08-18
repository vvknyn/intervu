"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ResumeData } from "@/types/resume";
import { LiveResumePreview } from "./LiveResumePreview";
import { EditingPanel } from "./EditingPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { exportToDocx } from "@/lib/export-docx";
import { resumeDataToParsedDocument, parseResumeContent } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import {
    fetchResumeVersionsAction,
    saveNamedResumeVersionAction,
} from "@/actions/resume-summary";
import type { SavedResumeVersion } from "@/lib/resume/set-resume";
import {
    FloppyDisk,
    DownloadSimple,
    ArrowLeft,
    Eye,
    PencilSimple,
    CircleNotch,
    Check,
    ClockCounterClockwise,
    GitBranch,
    GitDiff,
    X,
    BookmarkSimple,
    ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface ResumeEditorProps {
    initialData: ResumeData;
    onSave: (data: ResumeData) => Promise<boolean | void>;
    onClose: () => void;
    className?: string;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function parseVersionContentToResumeData(content: string): ResumeData | null {
    if (!content) return null;
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            const json = JSON.parse(trimmed);
            if (json.profile && Array.isArray(json.experience)) {
                return json as ResumeData;
            }
        } catch {
            // Ignore
        }
    }
    // Try parsing as text
    try {
        const parsed = parseResumeContent(content);
        return {
            profile: {
                name: parsed.name || "",
                profession: "",
                yearsOfExperience: 0,
                location: "",
                email: "",
                phone: "",
            },
            generatedSummary: parsed.sections.find((s) => s.heading.toLowerCase().includes("summary"))?.blocks.map((b) => (b.kind === "paragraph" ? b.text : "")).join(" ") || "",
            competencies: [{ category: "Core Skills", skills: [] }],
            experience: [],
            education: [],
        };
    } catch {
        return null;
    }
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export function ResumeEditor({ initialData, onSave, onClose, className }: ResumeEditorProps) {
    const [data, setData] = useState<ResumeData>(initialData);
    const [originalBaseline, setOriginalBaseline] = useState<ResumeData>(initialData);
    const [compareBaseline, setCompareBaseline] = useState<ResumeData | null>(initialData);
    const [selectedSection, setSelectedSection] = useState<string | null>(null);
    const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showDiffs, setShowDiffs] = useState(false);

    // Version management state
    const [versionsOpen, setVersionsOpen] = useState(false);
    const [versions, setVersions] = useState<SavedResumeVersion[]>([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [newVersionLabel, setNewVersionLabel] = useState("");
    const [savingVersion, setSavingVersion] = useState(false);

    const loadVersions = useCallback(async () => {
        setLoadingVersions(true);
        try {
            const res = await fetchResumeVersionsAction();
            if (res.data) {
                setVersions(res.data);
            }
        } catch {
            // Ignore error
        } finally {
            setLoadingVersions(false);
        }
    }, []);

    useEffect(() => {
        if (versionsOpen) {
            void loadVersions();
        }
    }, [versionsOpen, loadVersions]);

    const handleUpdate = (updates: Partial<ResumeData>) => {
        setData((prev) => ({
            ...prev,
            ...updates,
        }));
        setHasUnsavedChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(data);
            setOriginalBaseline(data);
            setHasUnsavedChanges(false);
            toast.success("Resume updated and saved");
            void loadVersions();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save resume");
        } finally {
            setSaving(false);
        }
    };

    const handleSaveNewVersion = async () => {
        if (!newVersionLabel.trim()) return;
        setSavingVersion(true);
        try {
            const res = await saveNamedResumeVersionAction({
                data,
                label: newVersionLabel.trim(),
            });
            if (res.error) throw new Error(res.error);
            toast.success(`Saved version: "${newVersionLabel.trim()}"`);
            setNewVersionLabel("");
            void loadVersions();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save version");
        } finally {
            setSavingVersion(false);
        }
    };

    const handleRecallVersion = (ver: SavedResumeVersion) => {
        const parsed = ver.structuredData || parseVersionContentToResumeData(ver.content);
        if (!parsed) {
            toast.error("Could not parse this version's structured data.");
            return;
        }
        setData(parsed);
        setHasUnsavedChanges(true);
        toast.success(`Loaded version: "${ver.label}"`);
        setVersionsOpen(false);
    };

    const handleCompareVersion = (ver: SavedResumeVersion) => {
        const parsed = ver.structuredData || parseVersionContentToResumeData(ver.content);
        if (!parsed) {
            toast.error("Could not parse comparison data.");
            return;
        }
        setCompareBaseline(parsed);
        setShowDiffs(true);
        toast.success(`Comparing live against: "${ver.label}"`);
        setVersionsOpen(false);
    };

    const handleDownloadPdf = () => {
        try {
            const parsed = resumeDataToParsedDocument(data);
            const filename = deriveResumePdfFilename({
                company: null,
                role: null,
                fallbackLabel: data.profile?.name || "resume",
                dateIso: new Date().toISOString(),
            });
            const pdfBytes = renderResumePdf(parsed);
            downloadBlob(pdfBytes, `${filename}.pdf`, "application/pdf");
            toast.success("PDF generated");
        } catch {
            toast.error("Failed to generate PDF");
        }
    };

    const handleDownloadDocx = async () => {
        try {
            await exportToDocx(data);
            toast.success("Word document downloaded");
        } catch {
            toast.error("Failed to export Word document");
        }
    };

    const handleDownloadJson = () => {
        downloadBlob(
            JSON.stringify(data, null, 2),
            `${(data.profile?.name || "resume").toLowerCase().replace(/\s+/g, "_")}.json`,
            "application/json",
        );
    };

    return (
        <div
            className={cn(
                "relative flex h-[85vh] min-h-[640px] flex-col rounded-none border border-border bg-card shadow-none overflow-hidden",
                className,
            )}
        >
            {/* Top Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 py-3 sm:px-6 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-none"
                    >
                        <ArrowLeft size={14} /> Back
                    </Button>
                    <div className="hidden sm:block h-4 w-px bg-border" />
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
                            Live Template Editor
                        </span>
                        {hasUnsavedChanges ? (
                            <span className="rounded-none bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                Unsaved edits
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 rounded-none bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                <Check size={10} weight="bold" /> Saved
                            </span>
                        )}
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2">
                    {/* Versions Button */}
                    <Button
                        type="button"
                        variant={versionsOpen ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setVersionsOpen(!versionsOpen)}
                        className="gap-1 text-xs rounded-none"
                    >
                        <ClockCounterClockwise size={14} />
                        <span className="hidden sm:inline">Versions & Diffs</span>
                    </Button>

                    {/* Diff Toggle */}
                    <Button
                        type="button"
                        variant={showDiffs ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setShowDiffs(!showDiffs)}
                        className={cn(
                            "gap-1 text-xs rounded-none",
                            showDiffs && "border-amber-500 text-amber-600 dark:text-amber-400",
                        )}
                        title="Toggle visual diff highlights"
                    >
                        <GitDiff size={14} />
                        <span className="hidden md:inline">{showDiffs ? "Diffs On" : "Show Diffs"}</span>
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadPdf}
                        className="hidden sm:inline-flex gap-1 text-xs rounded-none shadow-none"
                    >
                        <DownloadSimple size={13} /> .pdf
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadDocx}
                        className="hidden lg:inline-flex gap-1 text-xs rounded-none shadow-none"
                    >
                        <DownloadSimple size={13} /> .docx
                    </Button>

                    <Button
                        type="button"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving}
                        className="gap-1.5 text-xs font-semibold rounded-none"
                    >
                        {saving ? <CircleNotch size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                        {saving ? "Saving…" : "Save Changes"}
                    </Button>
                </div>
            </div>

            {/* Mobile View Selector */}
            <div className="flex lg:hidden border-b border-border bg-muted/20 p-1">
                <button
                    type="button"
                    onClick={() => setMobileTab("edit")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-none transition-colors",
                        mobileTab === "edit"
                            ? "bg-card text-foreground border border-border"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    <PencilSimple size={14} /> Editor
                </button>
                <button
                    type="button"
                    onClick={() => setMobileTab("preview")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-none transition-colors",
                        mobileTab === "preview"
                            ? "bg-card text-foreground border border-border"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    <Eye size={14} /> Live Preview
                </button>
            </div>

            {/* Main Split Body */}
            <div className="flex-1 flex min-h-0 overflow-hidden relative">
                {/* Left Side: Editor */}
                <div
                    className={cn(
                        "w-full lg:w-[50%] xl:w-[48%] flex-col overflow-hidden border-border lg:border-r bg-card",
                        mobileTab === "edit" ? "flex" : "hidden lg:flex",
                    )}
                >
                    <EditingPanel
                        selectedSection={selectedSection}
                        data={data}
                        onUpdate={handleUpdate}
                        onNavigateSection={(section) => setSelectedSection(section)}
                    />
                </div>

                {/* Right Side: Live Template Preview */}
                <div
                    className={cn(
                        "flex-1 bg-muted/30 p-4 sm:p-6 lg:p-8 overflow-y-auto overflow-x-hidden items-start justify-center",
                        mobileTab === "preview" ? "flex" : "hidden lg:flex",
                    )}
                >
                    <div className="w-full max-w-[8.5in] transition-all">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground px-1">
                            <span className="font-mono text-[10.5px] uppercase tracking-wider">
                                Standard US Letter Layout
                            </span>
                            <div className="flex items-center gap-3">
                                {showDiffs && (
                                    <span className="font-mono text-[10.5px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                                        <GitDiff size={12} /> Diff Mode Active
                                    </span>
                                )}
                                <span className="font-mono text-[10.5px]">Click any section to edit</span>
                            </div>
                        </div>
                        <LiveResumePreview
                            data={data}
                            originalData={showDiffs ? compareBaseline : null}
                            showDiffs={showDiffs}
                            selectedSection={selectedSection}
                            onEdit={(section) => {
                                setSelectedSection(section);
                                setMobileTab("edit");
                            }}
                        />
                    </div>
                </div>

                {/* Version History Drawer / Slide-Over */}
                {versionsOpen && (
                    <div className="absolute inset-y-0 right-0 z-40 w-full sm:w-[380px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <div className="flex items-center gap-2">
                                <ClockCounterClockwise size={18} className="text-foreground" />
                                <h3 className="font-bold text-sm uppercase tracking-tight text-foreground">
                                    Version History & Diffs
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setVersionsOpen(false)}
                                className="rounded-none p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Drawer Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                            {/* Save current state as named snapshot */}
                            <div className="rounded-none border border-border bg-card p-3.5 space-y-2.5">
                                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
                                    <BookmarkSimple size={14} />
                                    <span>Save Current as New Version</span>
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={newVersionLabel}
                                        onChange={(e) => setNewVersionLabel(e.target.value)}
                                        placeholder="e.g. Tailored for Apple, Post-review v2..."
                                        className="h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void handleSaveNewVersion();
                                            }
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={handleSaveNewVersion}
                                        disabled={savingVersion || !newVersionLabel.trim()}
                                        className="h-8 text-xs rounded-none"
                                    >
                                        {savingVersion ? "Saving…" : "Save"}
                                    </Button>
                                </div>
                            </div>

                            {/* Saved Versions List */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="font-mono uppercase font-semibold">Saved Snapshots ({versions.length})</span>
                                    <button
                                        type="button"
                                        onClick={loadVersions}
                                        className="hover:underline font-mono text-[11px]"
                                    >
                                        Refresh
                                    </button>
                                </div>

                                {loadingVersions ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                                        <CircleNotch size={16} className="animate-spin" /> Loading history…
                                    </div>
                                ) : versions.length === 0 ? (
                                    <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border p-4">
                                        No saved versions on file yet. Save a version above to track iterations.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {versions.map((ver) => (
                                            <div
                                                key={ver.id}
                                                className="rounded-none border border-border bg-card p-3 space-y-2 text-xs transition-colors hover:border-foreground/40"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="font-semibold text-foreground leading-tight">
                                                        {ver.label}
                                                    </span>
                                                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                                        {formatDate(ver.saved_at)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleRecallVersion(ver)}
                                                        className="h-7 text-[11px] gap-1 rounded-none flex-1"
                                                    >
                                                        <ArrowCounterClockwise size={12} /> Recall
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleCompareVersion(ver)}
                                                        className="h-7 text-[11px] gap-1 rounded-none flex-1 text-amber-600 dark:text-amber-400"
                                                    >
                                                        <GitDiff size={12} /> Compare
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

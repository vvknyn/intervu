"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ResumeData } from "@/types/resume";
import { LiveResumePreview } from "./LiveResumePreview";
import { EditingPanel } from "./EditingPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabItem, TabNav } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";
import { exportToDocx } from "@/lib/export-docx";
import { downloadBlob } from "@/lib/export-utils";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { parseResumeContent } from "@/lib/resume/parse-resume-content";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import {
    deleteResumeVersionAction,
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
    Trash,
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
    // The diff baseline is one value with two sources. `originalBaseline` tracks
    // the last saved resume and advances on every save, so diffs re-baseline
    // once your work is persisted instead of flagging saved content as changed.
    // `compareBaseline` is the explicit override you pick from Version History;
    // null means "fall back to the saved state", which is the only way back.
    const [originalBaseline, setOriginalBaseline] = useState<ResumeData>(initialData);
    const [compareBaseline, setCompareBaseline] = useState<{ data: ResumeData; label: string; id: string } | null>(null);
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
    // Two-step delete: the first click arms the row, the second commits.
    // An inline confirm rather than window.confirm — a native modal blocks
    // the whole page and cannot be styled or dismissed by the app.
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

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
        setCompareBaseline({ data: parsed, label: ver.label, id: ver.id });
        setShowDiffs(true);
        toast.success(`Comparing live against: "${ver.label}"`);
        setVersionsOpen(false);
    };

    const handleDeleteVersion = async (ver: SavedResumeVersion) => {
        setDeletingId(ver.id);
        try {
            const res = await deleteResumeVersionAction(ver.id);
            if (res.error) throw new Error(res.error);
            setVersions((prev) => prev.filter((v) => v.id !== ver.id));
            // If the diff was baselined against this snapshot, that baseline
            // just stopped existing. Fall back to the last saved resume rather
            // than keep diffing against something the user deleted.
            setCompareBaseline((cur) => (cur?.id === ver.id ? null : cur));
            toast.success(`Deleted "${ver.label}"`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete version");
        } finally {
            setDeletingId(null);
            setConfirmDeleteId(null);
        }
    };

    const handleDownloadPdf = () => {
        void (async () => {
            try {
                const filename = deriveResumePdfFilename({
                    company: null,
                    role: null,
                    fallbackLabel: data.profile?.name || "resume",
                    dateIso: new Date().toISOString(),
                });
                await exportZipResumePdfFromData(data, `${filename}.pdf`);
                toast.success("PDF generated");
            } catch {
                toast.error("Failed to generate PDF");
            }
        })();
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
        toast.success("JSON downloaded");
    };

    return (
        <div
            className={cn(
                // Height subtracts only global chrome (TopBar + mobile tab bar).
                // Page header/tabs are hidden while this editor is open.
                "relative flex h-[calc(100dvh-7.25rem-env(safe-area-inset-bottom,0px))] min-h-0 flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] lg:h-[calc(100dvh-4.5rem)]",
                className,
            )}
        >
            {/* Top Toolbar */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2.5 shadow-[var(--shadow-bevel-highlight)] sm:px-6 sm:py-3">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                        className="shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-ctl"
                    >
                        <ArrowLeft /> Back
                    </Button>
                    <div className="hidden sm:block h-4 w-px shrink-0 bg-border" />
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="hidden truncate text-xs font-semibold text-foreground sm:inline">
                            Live template editor
                        </span>
                        {hasUnsavedChanges ? (
                            <span className="shrink-0 rounded-pill bg-surface-3 px-2 py-0.5 text-xs font-semibold text-warn border border-warn">
                                Unsaved
                            </span>
                        ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-3 px-2 py-0.5 text-xs font-semibold text-live border border-live">
                                <Check weight="bold" /> Saved
                            </span>
                        )}
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                    {/* Versions Button */}
                    <Button
                        type="button"
                        variant={versionsOpen ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setVersionsOpen(!versionsOpen)}
                        className="gap-1 text-xs rounded-ctl"
                        title="Versions & diffs"
                    >
                        <ClockCounterClockwise />
                        <span className="hidden sm:inline">Versions & diffs</span>
                    </Button>

                    {/* Diff Toggle */}
                    <Button
                        type="button"
                        variant={showDiffs ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setShowDiffs(!showDiffs)}
                        className={cn(
                            "gap-1 text-xs rounded-ctl",
                            showDiffs && "border-warn text-warn",
                        )}
                        title="Toggle visual diff highlights"
                    >
                        <GitDiff />
                        <span className="hidden md:inline">{showDiffs ? "Diffs on" : "Show diffs"}</span>
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadPdf}
                        className="hidden sm:inline-flex gap-1 text-xs rounded-ctl"
                    >
                        <DownloadSimple /> .pdf
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadDocx}
                        className="hidden lg:inline-flex gap-1 text-xs rounded-ctl"
                    >
                        <DownloadSimple /> .docx
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadJson}
                        title="Download the structured resume data"
                        className="hidden xl:inline-flex gap-1 text-xs rounded-ctl"
                    >
                        <DownloadSimple /> .json
                    </Button>

                    <Button
                        type="button"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving}
                        className="gap-1.5 text-xs font-semibold rounded-ctl"
                    >
                        {saving ? <CircleNotch className="animate-spin" /> : <FloppyDisk />}
                        <span className="sm:hidden">{saving ? "Saving…" : "Save"}</span>
                        <span className="hidden sm:inline">{saving ? "Saving…" : "Save changes"}</span>
                    </Button>
                </div>
            </div>

            {/* Mobile View Selector */}
            <TabNav aria-label="Editor or preview" className="border-b border-border lg:hidden">
                <TabItem current={mobileTab === "edit"} onClick={() => setMobileTab("edit")} className="flex-1">
                    <PencilSimple /> Editor
                </TabItem>
                <TabItem current={mobileTab === "preview"} onClick={() => setMobileTab("preview")} className="flex-1">
                    <Eye /> Live Preview
                </TabItem>
            </TabNav>

            {/* Main Split Body */}
            <div className="flex-1 flex min-h-0 overflow-hidden relative">
                {/* Left Side: Editor */}
                <div
                    className={cn(
                        "w-full lg:w-1/2 flex-col overflow-hidden border-border lg:border-r bg-surface",
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
                        "flex-1 bg-background p-4 sm:p-6 lg:p-8 overflow-y-auto overflow-x-hidden items-start justify-center",
                        mobileTab === "preview" ? "flex" : "hidden lg:flex",
                    )}
                >
                    <div className="w-full max-w-[8.5in] transition-all">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground px-1">
                            <span className="text-xs">
                                Standard US Letter Layout
                            </span>
                            <div className="flex items-center gap-3">
                                {showDiffs && (
                                    <span className="text-xs text-warn font-semibold flex items-center gap-1">
                                        <GitDiff />
                                        <span className="max-w-52 truncate">
                                            {compareBaseline ? `Comparing to "${compareBaseline.label}"` : "Comparing to last saved"}
                                        </span>
                                        {compareBaseline && (
                                            <button
                                                type="button"
                                                onClick={() => setCompareBaseline(null)}
                                                className="underline underline-offset-2 hover:no-underline"
                                                title="Compare against the last saved resume instead"
                                            >
                                                reset
                                            </button>
                                        )}
                                    </span>
                                )}
                                <span className="text-xs">Click any section to edit</span>
                            </div>
                        </div>
                        <LiveResumePreview
                            data={data}
                            originalData={showDiffs ? (compareBaseline?.data ?? originalBaseline) : null}
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
                    <div className="absolute inset-y-0 right-0 z-40 w-full sm:w-96 bg-surface-2 border-l border-border flex flex-col animate-in slide-in-from-right duration-200 shadow-[var(--shadow-overlay)]">
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <div className="flex items-center gap-2">
                                <ClockCounterClockwise className="text-foreground" />
                                <h3 className="font-semibold text-sm text-foreground">
                                    Version History & Diffs
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setVersionsOpen(false)}
                                className="rounded-ctl p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Drawer Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                            {/* Save current state as named snapshot */}
                            <div className="rounded-panel border border-border bg-surface p-3.5 space-y-2.5 shadow-[var(--shadow-bevel-highlight)]">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                    <BookmarkSimple />
                                    <span>Save Current as New Version</span>
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={newVersionLabel}
                                        onChange={(e) => setNewVersionLabel(e.target.value)}
                                        placeholder="e.g. Tailored for Apple, Post-review v2..."
                                        className="h-8 text-base md:text-xs"
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
                                        className="h-8 text-xs rounded-ctl"
                                    >
                                        {savingVersion ? "Saving…" : "Save"}
                                    </Button>
                                </div>
                            </div>

                            {/* Saved Versions List */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="font-semibold">Saved Snapshots ({versions.length})</span>
                                    <button
                                        type="button"
                                        onClick={loadVersions}
                                        className="hover:underline text-xs"
                                    >
                                        Refresh
                                    </button>
                                </div>

                                {loadingVersions ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                                        <CircleNotch size={16} className="animate-spin" /> Loading history…
                                    </div>
                                ) : versions.length === 0 ? (
                                    <div className="py-8 text-center text-xs text-muted-foreground border border-border p-4">
                                        No saved versions on file yet. Save a version above to track iterations.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {versions.map((ver) => (
                                            <div
                                                key={ver.id}
                                                className="rounded-panel border border-border bg-surface p-3 space-y-2 text-xs transition-colors hover:border-border-strong"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="font-semibold text-foreground leading-tight">
                                                        {ver.label}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground shrink-0">
                                                        {formatDate(ver.saved_at)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 pt-1 border-t border-border">
                                                    {confirmDeleteId === ver.id ? (
                                                        <>
                                                            <span className="flex-1 text-xs font-semibold text-danger-text">
                                                                Delete this version?
                                                            </span>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => setConfirmDeleteId(null)}
                                                                className="h-7 text-xs rounded-ctl"
                                                            >
                                                                Cancel
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="destructive"
                                                                size="sm"
                                                                disabled={deletingId === ver.id}
                                                                onClick={() => void handleDeleteVersion(ver)}
                                                                className="h-7 text-xs gap-1 rounded-ctl"
                                                            >
                                                                {deletingId === ver.id ? (
                                                                    <CircleNotch className="animate-spin" />
                                                                ) : (
                                                                    <Trash />
                                                                )}
                                                                Delete
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleRecallVersion(ver)}
                                                                className="h-7 text-xs gap-1 rounded-ctl flex-1"
                                                            >
                                                                <ArrowCounterClockwise /> Recall
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleCompareVersion(ver)}
                                                                className="h-7 text-xs gap-1 rounded-ctl flex-1 text-warn"
                                                            >
                                                                <GitDiff /> Compare
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                title={`Delete "${ver.label}"`}
                                                                onClick={() => setConfirmDeleteId(ver.id)}
                                                                className="h-7 w-7 p-0 shrink-0 rounded-ctl text-muted-foreground hover:text-danger-text"
                                                            >
                                                                <Trash />
                                                            </Button>
                                                        </>
                                                    )}
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

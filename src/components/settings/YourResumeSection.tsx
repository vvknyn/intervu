"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Trash, PencilSimple, FileText } from "@phosphor-icons/react";
import { WaitState } from "@/components/ui/wait-state";
import type { User } from "@/lib/firebase/client-auth";
import { fetchResumeSummaryAction, uploadBaseResumeAction, deleteBaseResumeAction, type ResumeSummary } from "@/actions/resume-summary";
import { saveResumeData } from "@/actions/resume";
import { extractResumeFileText, resumeFileExtension } from "@/lib/resume/extract-file-text";
import { downloadBlob } from "@/lib/export-utils";
import { exportZipResumePdf, exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { deriveResumePdfFilename } from "@/lib/resume/pdf-filename";
import { captureEvent } from "@/lib/analytics/events";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";
import { ResumeEditor } from "@/components/resume-builder/ResumeEditor";
import { LiveResumePreview } from "@/components/resume-builder/LiveResumePreview";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import type { ResumeData } from "@/types/resume";

interface YourResumeSectionProps {
    user: User | null;
    onLoginClick: () => void;
    embedded?: boolean;
    onEditorActiveChange?: (active: boolean) => void;
}

function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function downloadBaseResumePdf(summary: Extract<ResumeSummary, { source: "resume_text" | "resume_data" }>) {
    const name = summary.source === "resume_data" ? summary.resume_data.profile?.name : null;
    const filename = deriveResumePdfFilename({
        company: null,
        role: null,
        fallbackLabel: name || "resume",
        dateIso: summary.updatedAt ?? new Date().toISOString(),
    });
    if (summary.source === "resume_data") {
        await exportZipResumePdfFromData(summary.resume_data, `${filename}.pdf`);
        return;
    }
    await exportZipResumePdf(summary.resume_text, `${filename}.pdf`);
}

function defaultResumeData(userEmail?: string, userName?: string): ResumeData {
    return {
        profile: {
            name: userName || "",
            profession: "",
            yearsOfExperience: 0,
            location: "",
            email: userEmail || "",
            phone: "",
            linkedin: "",
        },
        generatedSummary: "",
        competencies: [
            { category: "Languages & Frameworks", skills: [] },
            { category: "Tools & Technologies", skills: [] },
        ],
        experience: [],
        education: [],
    };
}

function summaryToResumeData(summary: ResumeSummary | null, user?: User | null): ResumeData {
    if (!summary || summary.source === "none") {
        return defaultResumeData(user?.email || undefined, user?.displayName || undefined);
    }
    if (summary.source === "resume_data") {
        return summary.resume_data;
    }
    if (summary.source === "resume_text") {
        // Same structuring rules matching uses for a text-only résumé
        // (`fetchResumeData`, actions/resume.ts) and the PDF export uses
        // (`exportZipResumePdf`), so the preview, the editor, the download
        // and the matches all read one version of it. The older section
        // parser here left the summary as the file's first 300 characters
        // (name, email and phone included) and the profession blank.
        const data = resumeDataFromPlainText(summary.resume_text);
        return {
            ...data,
            profile: {
                ...data.profile,
                name: data.profile.name || user?.displayName || "",
                email: data.profile.email || user?.email || "",
            },
        };
    }
    return defaultResumeData(user?.email || undefined, user?.displayName || undefined);
}

export function YourResumeSection({ user, onLoginClick, embedded, onEditorActiveChange }: YourResumeSectionProps) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const [viewMode, setViewMode] = useState<"summary" | "upload" | "live_editor">("summary");

    useEffect(() => {
        onEditorActiveChange?.(viewMode === "live_editor");
    }, [viewMode, onEditorActiveChange]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            setStatus("loading");
            for (let attempt = 0; attempt < 4; attempt++) {
                const res = await fetchResumeSummaryAction();
                if (cancelled) return;
                if (!res.error && res.data) {
                    setSummary(res.data);
                    setStatus("ready");
                    return;
                }
                if (attempt < 3) await new Promise((r) => setTimeout(r, 400));
            }
            if (!cancelled) setStatus("error");
        })();
        return () => {
            cancelled = true;
        };
    }, [user, retryToken]);

    const handleSaveEditor = async (updatedData: ResumeData) => {
        const res = await saveResumeData(updatedData, "manual");
        if (res.error) throw new Error(res.error);
        setRetryToken((t) => t + 1);
    };

    if (!user) {
        const guestContent = (
            <section className={embedded ? undefined : "pt-6 border-t border-border"}>
                <h2 className="text-base font-semibold leading-snug mb-1">Your résumé</h2>
                <p className="text-sm text-muted-foreground">
                    <button onClick={onLoginClick} className="text-foreground underline underline-offset-2 hover:underline">
                        {AUTH_CTA_LABEL}
                    </button>{" "}
                    to see the resume your agent has on file.
                </p>
            </section>
        );
        if (embedded) {
            return (
                <div className="mb-3 rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]">
                    {guestContent}
                </div>
            );
        }
        return guestContent;
    }

    if (viewMode === "live_editor") {
        return (
            <section className="min-h-0">
                <ResumeEditor
                    initialData={summaryToResumeData(summary, user)}
                    onSave={handleSaveEditor}
                    onClose={() => setViewMode("summary")}
                />
            </section>
        );
    }

    const content = (
        <section className={embedded ? undefined : "pt-6 border-t border-border"}>
            <h2 className="text-base font-semibold leading-snug mb-1">Your résumé</h2>
            <p className="text-sm text-muted-foreground mb-4">
                {embedded
                    ? "One base file. Edit the template in the browser, or upload a PDF or Word file."
                    : "The resume your agent has on file."}
            </p>

            {status === "loading" && (
                <WaitState label="Loading your résumé" className="py-2" />
            )}

            {status === "error" && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load your résumé.</p>
                    <Button variant="outline" size="sm" onClick={() => setRetryToken((t) => t + 1)}>
                        Try again
                    </Button>
                </div>
            )}

            {status === "ready" && summary && (
                viewMode === "upload" ? (
                    <ResumeUploadForm
                        showCancel={summary.source !== "none"}
                        onCancel={() => setViewMode("summary")}
                        onSaved={() => {
                            setViewMode("summary");
                            setRetryToken((t) => t + 1);
                        }}
                    />
                ) : (
                    <ResumeSummaryBody
                        summary={summary}
                        user={user}
                        onReplace={() => setViewMode("upload")}
                        onOpenEditor={() => setViewMode("live_editor")}
                        onDeleted={() => setRetryToken((t) => t + 1)}
                    />
                )
            )}
        </section>
    );

    if (embedded) {
        return (
            <div className="mb-3 rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]">
                {content}
            </div>
        );
    }

    return content;
}

function ResumeSummaryBody({
    summary,
    user,
    onReplace,
    onOpenEditor,
    onDeleted,
}: {
    summary: ResumeSummary;
    user: User | null;
    onReplace: () => void;
    onOpenEditor: () => void;
    onDeleted: () => void;
}) {
    const updatedLabel = formatDate(summary.updatedAt);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, startDeleteTransition] = useTransition();

    const [deleteError, setDeleteError] = useState<string | null>(null);

    const handleDelete = () => {
        setDeleteError(null);
        startDeleteTransition(async () => {
            // A failed delete used to close the prompt and reload as if it
            // had worked.
            try {
                const res = await deleteBaseResumeAction();
                if (res.error) {
                    setDeleteError("Couldn't delete your résumé. Try again.");
                    return;
                }
            } catch {
                setDeleteError("Couldn't delete your résumé. Try again.");
                return;
            }
            setConfirmingDelete(false);
            onDeleted();
        });
    };

    if (summary.source === "none") {
        return (
            <div className="space-y-4 rounded-panel border border-border bg-surface p-6 text-center shadow-[var(--shadow-bevel-highlight)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-pill border border-border bg-surface-2 text-foreground shadow-[var(--shadow-bevel-inset)]">
                    <FileText size={24} />
                </div>
                <div className="space-y-1 max-w-sm mx-auto">
                    <h3 className="text-sm font-semibold text-foreground">No resume on file</h3>
                    <p className="text-xs text-muted-foreground">
                        Edit the standard template in your browser, or upload an existing PDF or Word file.
                    </p>
                </div>
                <div className="flex flex-col items-center gap-2 pt-1">
                    <Button size="sm" onClick={onOpenEditor} className="w-full gap-1.5 sm:w-auto">
                        <PencilSimple /> Edit template
                    </Button>
                    <button type="button" onClick={onReplace} className="text-xs text-foreground underline underline-offset-2 hover:underline">
                        or upload a PDF or Word file
                    </button>
                </div>
            </div>
        );
    }

    const manageRow = (
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
                type="button"
                size="sm"
                onClick={onOpenEditor}
                className="w-full gap-1.5 sm:w-auto"
            >
                <PencilSimple /> Edit template
            </Button>
            <Button variant="outline" size="sm" onClick={onReplace} className="w-full gap-1.5 sm:w-auto">
                <Upload /> Replace
            </Button>
            {confirmingDelete ? (
                <InlineConfirm
                    prompt="Delete this résumé and its saved versions?"
                    busy={deleting}
                    busyLabel="Deleting…"
                    onConfirm={handleDelete}
                    onCancel={() => setConfirmingDelete(false)}
                />
            ) : (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmingDelete(true)}
                    className="w-full gap-1.5 text-danger-text hover:text-danger-text sm:w-auto"
                >
                    <Trash />
                    Delete
                </Button>
            )}
        </div>
    );

    // One document render for both sources — `summaryToResumeData` already
    // normalizes `resume_text` (parsed) and `resume_data` (as-is) into the
    // same `ResumeData` shape, so the base resume renders as the actual
    // typeset document (the same component the tailoring flow's live
    // preview uses) instead of a raw text dump or a settings-style grid.
    const resumeData = summaryToResumeData(summary, user);
    return (
        <div className="space-y-3">
            {updatedLabel && <p className="text-xs text-muted-foreground">Last updated {updatedLabel}</p>}
            <div className="max-h-96 overflow-y-auto rounded-panel border border-border bg-background p-4 sm:p-6">
                <LiveResumePreview data={resumeData} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button variant="outline" size="sm" onClick={() => void downloadBaseResumePdf(summary)} className="w-full sm:w-auto">
                    Download .pdf
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        summary.source === "resume_text"
                            ? downloadBlob(summary.resume_text, "resume.txt", "text/plain")
                            : downloadBlob(JSON.stringify(summary.resume_data, null, 2), "resume.json", "application/json")
                    }
                    className="w-full sm:w-auto"
                >
                    {summary.source === "resume_text" ? "Download .txt" : "Download .json"}
                </Button>
            </div>
            {manageRow}
            {deleteError && (
                <p role="alert" className="text-xs text-danger-text">
                    {deleteError}
                </p>
            )}
        </div>
    );
}

function ResumeUploadForm({
    showCancel,
    onCancel,
    onSaved,
}: {
    showCancel: boolean;
    onCancel: () => void;
    onSaved: () => void;
}) {
    const [text, setText] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [extracting, setExtracting] = useState(false);
    const [pending, startTransition] = useTransition();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setError(null);
        if (!resumeFileExtension(file.name)) {
            setError("Unsupported file type. Please use .txt, .md, .pdf, or .docx.");
            return;
        }
        setExtracting(true);
        try {
            setText(await extractResumeFileText(file));
            setFileName(file.name);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't read that file.");
        } finally {
            setExtracting(false);
        }
    };

    const handleSave = () => {
        setError(null);
        startTransition(async () => {
            // The label names this upload in Versions & diffs; without one it
            // was filed as "chat upload", the MCP tool's default.
            const res = await uploadBaseResumeAction({ text, label: fileName ?? "Pasted text" });
            if (res.error) {
                setError(res.error);
                return;
            }
            captureEvent("resume_uploaded", { surface: "settings" });
            onSaved();
        });
    };

    const busy = pending || extracting;

    return (
        <div className="space-y-3">
            <Textarea
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    setFileName(null);
                }}
                placeholder="Paste your résumé text here, or choose a file below…"
                className="min-h-40 font-sans"
                disabled={busy}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                    }}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy} className="w-full gap-1.5 sm:w-auto">
                    <Upload />
                    {extracting ? "Reading…" : "Choose file"}
                </Button>
                {fileName && <span className="text-xs text-muted-foreground break-all">{fileName}</span>}
            </div>
            {error && <p className="text-xs text-danger-text">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" disabled={busy || !text.trim()} onClick={handleSave} className="w-full sm:w-auto">
                    {pending ? "Saving…" : "Save"}
                </Button>
                {showCancel && (
                    <Button variant="outline" size="sm" onClick={onCancel} disabled={busy} className="w-full sm:w-auto">
                        Cancel
                    </Button>
                )}
            </div>
        </div>
    );
}

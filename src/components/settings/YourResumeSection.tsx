"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CircleNotch, Upload, Trash, PencilSimple, FileText, Sparkle, ClockCounterClockwise } from "@phosphor-icons/react";
import type { User } from "@/lib/firebase/client-auth";
import { fetchResumeSummaryAction, uploadBaseResumeAction, deleteBaseResumeAction, type ResumeSummary } from "@/actions/resume-summary";
import { saveResumeData } from "@/actions/resume";
import { extractResumeFileText, resumeFileExtension } from "@/lib/resume/extract-file-text";
import { parseResumeContent, resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { ResumeEditor } from "@/components/resume-builder/ResumeEditor";
import type { ResumeData, ResumeExperience, ResumeEducation } from "@/types/resume";

interface YourResumeSectionProps {
    user: User | null;
    onLoginClick: () => void;
    embedded?: boolean;
}

const TEXT_PREVIEW_LINES = 40;

function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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

function downloadBaseResumePdf(summary: Extract<ResumeSummary, { source: "resume_text" | "resume_data" }>) {
    const parsed = summary.source === "resume_text" ? parseResumeContent(summary.resume_text) : resumeDataToParsedDocument(summary.resume_data);
    const name = summary.source === "resume_data" ? summary.resume_data.profile?.name : null;
    const filename = deriveResumePdfFilename({
        company: null,
        role: null,
        fallbackLabel: name || "resume",
        dateIso: summary.updatedAt ?? new Date().toISOString(),
    });
    downloadBlob(renderResumePdf(parsed), `${filename}.pdf`, "application/pdf");
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
        const parsed = parseResumeContent(summary.resume_text);
        let summaryText = "";
        const competencies: { category: string; skills: string[] }[] = [];
        const experience: ResumeExperience[] = [];
        const education: ResumeEducation[] = [];

        for (const sec of parsed.sections) {
            const h = sec.heading.toLowerCase();
            if (h.includes("summary") || h.includes("profile") || h.includes("about")) {
                summaryText = sec.blocks
                    .map((b) => (b.kind === "paragraph" ? b.text : b.kind === "bullets" ? b.items.join("\n") : ""))
                    .filter(Boolean)
                    .join("\n\n");
            } else if (h.includes("skill") || h.includes("competenc") || h.includes("technolog")) {
                for (const b of sec.blocks) {
                    if (b.kind === "competency") {
                        competencies.push({
                            category: b.category,
                            skills: b.items.split(",").map((s) => s.trim()).filter(Boolean),
                        });
                    } else if (b.kind === "paragraph" || b.kind === "bullets") {
                        const items = b.kind === "paragraph" ? [b.text] : b.items;
                        competencies.push({
                            category: "Skills",
                            skills: items,
                        });
                    }
                }
            } else if (h.includes("experience") || h.includes("employment") || h.includes("work") || h.includes("history")) {
                for (let i = 0; i < sec.blocks.length; i++) {
                    const b = sec.blocks[i];
                    if (b.kind === "entry") {
                        const parts = b.title.split("|").map((p) => p.trim());
                        experience.push({
                            id: `exp-${i + 1}`,
                            role: parts[0] || b.title,
                            company: parts[1] || "",
                            dates: b.dateRight || "",
                            description: b.bullets.map((l) => `• ${l}`).join("\n"),
                        });
                    }
                }
            } else if (h.includes("education") || h.includes("degree") || h.includes("academic")) {
                for (let i = 0; i < sec.blocks.length; i++) {
                    const b = sec.blocks[i];
                    if (b.kind === "entry") {
                        const parts = b.title.split("|").map((p) => p.trim());
                        education.push({
                            id: `edu-${i + 1}`,
                            degree: parts[0] || b.title,
                            institution: parts[1] || "",
                            year: b.dateRight || "",
                        });
                    } else if (b.kind === "paragraph") {
                        education.push({
                            id: `edu-${i + 1}`,
                            degree: b.text,
                            institution: "",
                        });
                    }
                }
            }
        }

        const contactParts = (parsed.contactLine || "").split("|").map((p) => p.trim());
        const email = contactParts.find((p) => p.includes("@")) || user?.email || "";
        const phone = contactParts.find((p) => /[\d\-+()]{7,}/.test(p)) || "";
        const linkedin = contactParts.find((p) => /linkedin/i.test(p)) || "";
        const location = contactParts.find((p) => p !== email && p !== phone && p !== linkedin) || "";

        return {
            profile: {
                name: parsed.name || user?.displayName || "",
                profession: "",
                yearsOfExperience: 0,
                location,
                email,
                phone,
                linkedin,
            },
            generatedSummary: summaryText || summary.resume_text.slice(0, 300),
            competencies: competencies.length > 0 ? competencies : [{ category: "Core Skills", skills: [] }],
            experience: experience.length > 0 ? experience : [],
            education: education.length > 0 ? education : [],
        };
    }
    return defaultResumeData(user?.email || undefined, user?.displayName || undefined);
}

export function YourResumeSection({ user, onLoginClick, embedded }: YourResumeSectionProps) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const [viewMode, setViewMode] = useState<"summary" | "upload" | "live_editor">("summary");

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
        return (
            <section className={embedded ? undefined : "pt-6 border-t border-border"}>
                <h2 className="text-[15px] font-semibold tracking-[-0.02em] mb-1">Your resume</h2>
                <p className="text-sm text-muted-foreground">
                    <button onClick={onLoginClick} className="underline text-brand hover:text-brand/80">
                        login
                    </button>{" "}
                    to see the resume your agent has on file.
                </p>
            </section>
        );
    }

    if (viewMode === "live_editor") {
        return (
            <section className="space-y-4">
                <ResumeEditor
                    initialData={summaryToResumeData(summary, user)}
                    onSave={handleSaveEditor}
                    onClose={() => setViewMode("summary")}
                />
            </section>
        );
    }

    return (
        <section className={embedded ? undefined : "pt-6 border-t border-border"}>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] mb-1">Your resume</h2>
            <p className="text-[13px] text-muted-foreground mb-4">
                {embedded
                    ? "One base file. Live modify directly in the canonical template or upload a document."
                    : "The resume your agent has on file."}
            </p>

            {status === "loading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CircleNotch size={16} className="animate-spin" />
                    Loading...
                </div>
            )}

            {status === "error" && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load your resume.</p>
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
                        onReplace={() => setViewMode("upload")}
                        onOpenEditor={() => setViewMode("live_editor")}
                        onDeleted={() => setRetryToken((t) => t + 1)}
                    />
                )
            )}
        </section>
    );
}

function ResumeSummaryBody({
    summary,
    onReplace,
    onOpenEditor,
    onDeleted,
}: {
    summary: ResumeSummary;
    onReplace: () => void;
    onOpenEditor: () => void;
    onDeleted: () => void;
}) {
    const updatedLabel = formatDate(summary.updatedAt);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, startDeleteTransition] = useTransition();

    const handleDelete = () => {
        startDeleteTransition(async () => {
            await deleteBaseResumeAction();
            setConfirmingDelete(false);
            onDeleted();
        });
    };

    if (summary.source === "none") {
        return (
            <div className="space-y-4 rounded-none border border-dashed border-border bg-card p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground">
                    <FileText size={24} />
                </div>
                <div className="space-y-1 max-w-sm mx-auto">
                    <h3 className="text-sm font-bold uppercase tracking-tight text-foreground">No Resume on File</h3>
                    <p className="text-xs text-muted-foreground">
                        Modify a standard template directly in your browser, or upload an existing PDF/Word file.
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <Button size="sm" onClick={onOpenEditor} className="gap-1.5 text-xs font-semibold rounded-none">
                        <PencilSimple size={14} /> Open Live Template Editor
                    </Button>
                    <Button variant="outline" size="sm" onClick={onReplace} className="gap-1.5 text-xs rounded-none">
                        <Upload size={14} /> Upload File
                    </Button>
                </div>
            </div>
        );
    }

    const manageRow = (
        <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
                type="button"
                size="sm"
                onClick={onOpenEditor}
                className="gap-1.5 text-xs font-semibold rounded-none"
            >
                <PencilSimple size={13} /> Modify in Live Editor
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenEditor} className="gap-1.5 text-xs rounded-none">
                <ClockCounterClockwise size={13} /> Versions & Diffs
            </Button>
            <Button variant="outline" size="sm" onClick={onReplace} className="gap-1.5 text-xs rounded-none">
                <Upload size={13} /> Replace / Upload
            </Button>
            {confirmingDelete ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    Delete this resume?
                    <Button variant="destructive" size="sm" disabled={deleting} onClick={handleDelete} className="gap-1.5 rounded-none">
                        {deleting ? <CircleNotch size={12} className="animate-spin" /> : <Trash size={12} />}
                        {deleting ? "Deleting…" : "Confirm"}
                    </Button>
                    <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="underline hover:text-foreground">
                        Cancel
                    </button>
                </span>
            ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)} className="gap-1.5 text-xs text-destructive hover:text-destructive rounded-none">
                    <Trash size={13} />
                    Delete
                </Button>
            )}
        </div>
    );

    if (summary.source === "resume_text") {
        const preview = summary.resume_text.split("\n").slice(0, TEXT_PREVIEW_LINES).join("\n");
        return (
            <div className="space-y-3">
                {updatedLabel && <p className="text-xs text-muted-foreground">Last updated {updatedLabel}</p>}
                <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/30 border border-border rounded-none p-4 max-h-80 overflow-y-auto">
                    {preview}
                </pre>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => downloadBaseResumePdf(summary)} className="text-xs rounded-none">
                        Download .pdf
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadBlob(summary.resume_text, "resume.txt", "text/plain")}
                        className="text-xs rounded-none"
                    >
                        Download .txt
                    </Button>
                </div>
                {manageRow}
            </div>
        );
    }

    const { profile, experience } = summary.resume_data;
    const experienceCount = experience?.length || 0;
    return (
        <div className="space-y-3">
            {updatedLabel && <p className="text-xs text-muted-foreground">Last updated {updatedLabel}</p>}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 items-baseline text-xs rounded-none border border-border bg-card p-4">
                {profile?.name && (
                    <>
                        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Name:</span>
                        <span className="font-semibold text-foreground">{profile.name}</span>
                    </>
                )}
                {profile?.profession && (
                    <>
                        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Headline:</span>
                        <span className="text-foreground">{profile.profession}</span>
                    </>
                )}
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Experience:</span>
                <span className="text-foreground">{experienceCount} {experienceCount === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadBaseResumePdf(summary)} className="text-xs shadow-2xs">
                    Download .pdf
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadBlob(JSON.stringify(summary.resume_data, null, 2), "resume.json", "application/json")}
                    className="text-xs shadow-2xs"
                >
                    Download .json
                </Button>
            </div>
            {manageRow}
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
            const res = await uploadBaseResumeAction({ text });
            if (res.error) {
                setError(res.error);
                return;
            }
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
                placeholder="Paste your resume text here, or choose a file below…"
                className="min-h-[160px] font-sans text-base md:text-sm"
                disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx,.doc"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                    }}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy} className="gap-1.5 text-xs shadow-2xs">
                    <Upload size={14} />
                    {extracting ? "Reading…" : "Choose file"}
                </Button>
                {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
                <Button size="sm" disabled={busy || !text.trim()} onClick={handleSave} className="text-xs font-semibold shadow-xs">
                    {pending ? "Saving…" : "Save"}
                </Button>
                {showCancel && (
                    <Button variant="outline" size="sm" onClick={onCancel} disabled={busy} className="text-xs shadow-2xs">
                        Cancel
                    </Button>
                )}
            </div>
        </div>
    );
}

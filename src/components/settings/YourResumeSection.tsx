"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CircleNotch, Upload, Trash } from "@phosphor-icons/react";
import type { User } from "@/lib/firebase/client-auth";
import { fetchResumeSummaryAction, uploadBaseResumeAction, deleteBaseResumeAction, type ResumeSummary } from "@/actions/resume-summary";
import { extractResumeFileText, resumeFileExtension } from "@/lib/resume/extract-file-text";
import { parseResumeContent, resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, deriveResumePdfFilename } from "@/lib/resume/render-pdf";

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

/** Same client-side blob-download shape as export-utils.ts's
 *  exportStoriesToText and SettingsContainer's handleExportData — no
 *  download API route needed for a file that already lives in the client's
 *  hands. */
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

/** Renders + downloads the base résumé as a PDF (R4/R5) — the SAME
 *  renderer the pursuit-variant download and the R5a MCP-chat link use,
 *  via the two adapters into `ParsedResumeDocument` (parse-resume-
 *  content.ts): free text for `resume_text`, a direct field mapping for
 *  structured `resume_data`. */
function downloadBaseResumePdf(summary: Extract<ResumeSummary, { source: "resume_text" | "resume_data" }>) {
    const parsed = summary.source === "resume_text" ? parseResumeContent(summary.resume_text) : resumeDataToParsedDocument(summary.resume_data);
    const name = summary.source === "resume_data" ? summary.resume_data.profile.name : null;
    const filename = deriveResumePdfFilename({
        company: null,
        role: null,
        fallbackLabel: name || "resume",
        dateIso: summary.updatedAt ?? new Date().toISOString(),
    });
    downloadBlob(renderResumePdf(parsed), `${filename}.pdf`, "application/pdf");
}

/**
 * Read/write surface for the base résumé the agent uses (R1, 2026-08-09
 * user report: the infra existed agent-side only — `set-resume.ts`/`base-
 * resume.ts`/the MCP `get_resume`/`set_resume` tools — with zero upload
 * surface on the web account). Upload/Replace reuse `uploadBaseResumeAction`
 * -> `setBaseResumeForUser`/`planResumeUpload`, the EXACT write seam
 * `set_resume` uses, so a web upload and a chat-filed résumé share one
 * planner. That module never calls an LLM (see its own doc comment) — no
 * "Structure with AI" step is wired here; this ships text-first, mechanical
 * extraction only for PDF/DOCX (unpdf/mammoth, already in package.json —
 * see extract-file-text.ts), matching the binding no-AI-on-this-path rule.
 */
export function YourResumeSection({ user, onLoginClick, embedded }: YourResumeSectionProps) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    // Bumped by the "Try again" button AND after a successful upload/delete
    // — one fetch-with-retry implementation, one re-fetch-after-write path,
    // instead of hand-constructing the post-write summary shape here.
    const [retryToken, setRetryToken] = useState(0);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            // Same cookie-race retry as AgentPreferencesSection.loadPreferences:
            // right after sign-in the client `user` can flip truthy before the
            // server session cookie catches up, so an early "Unauthorized" here
            // almost always means that race, not a real denial.
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

    return (
        <section className={embedded ? undefined : "pt-6 border-t border-border"}>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] mb-1">Your resume</h2>
            <p className="text-[13px] text-muted-foreground mb-4">
                {embedded
                    ? "One base file. Your agent uses this overnight; the tracker links versions per role later if needed."
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
                editing ? (
                    <ResumeUploadForm
                        showCancel={summary.source !== "none"}
                        onCancel={() => setEditing(false)}
                        onSaved={() => {
                            setEditing(false);
                            setRetryToken((t) => t + 1);
                        }}
                    />
                ) : (
                    <ResumeSummaryBody summary={summary} onReplace={() => setEditing(true)} onDeleted={() => setRetryToken((t) => t + 1)} />
                )
            )}
        </section>
    );
}

function ResumeSummaryBody({
    summary,
    onReplace,
    onDeleted,
}: {
    summary: ResumeSummary;
    onReplace: () => void;
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
            <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    No resume yet — send one to your agent on WhatsApp, upload one below, or your agent can build one with you.
                </p>
                <Button variant="outline" size="sm" onClick={onReplace} className="gap-1.5">
                    <Upload size={14} />
                    Upload a resume
                </Button>
            </div>
        );
    }

    const manageRow = (
        <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onReplace}>
                Replace
            </Button>
            {confirmingDelete ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    Delete this resume?
                    <Button variant="destructive" size="sm" disabled={deleting} onClick={handleDelete} className="gap-1.5">
                        {deleting ? <CircleNotch size={12} className="animate-spin" /> : <Trash size={12} />}
                        {deleting ? "Deleting…" : "Confirm"}
                    </Button>
                    <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="underline hover:text-foreground">
                        Cancel
                    </button>
                </span>
            ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)} className="gap-1.5 text-[#8a3a3a] border-[#e2c4c4] hover:text-[#8a3a3a]">
                    <Trash size={14} />
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
                <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/30 border border-border rounded-none p-3 max-h-80 overflow-y-auto">
                    {preview}
                </pre>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => downloadBaseResumePdf(summary)}>
                        Download .pdf
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadBlob(summary.resume_text, "resume.txt", "text/plain")}
                    >
                        Download .txt
                    </Button>
                </div>
                {manageRow}
            </div>
        );
    }

    const { profile, experience } = summary.resume_data;
    const experienceCount = experience.length;
    return (
        <div className="space-y-3">
            {updatedLabel && <p className="text-xs text-muted-foreground">Last updated {updatedLabel}</p>}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline text-sm">
                {profile.name && (
                    <>
                        <span className="text-muted-foreground text-right whitespace-nowrap py-1">name:</span>
                        <span className="py-1">{profile.name}</span>
                    </>
                )}
                {profile.profession && (
                    <>
                        <span className="text-muted-foreground text-right whitespace-nowrap py-1">headline:</span>
                        <span className="py-1">{profile.profession}</span>
                    </>
                )}
                <span className="text-muted-foreground text-right whitespace-nowrap py-1">experience:</span>
                <span className="py-1">{experienceCount} {experienceCount === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadBaseResumePdf(summary)}>
                    Download .pdf
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadBlob(JSON.stringify(summary.resume_data, null, 2), "resume.json", "application/json")}
                >
                    Download .json
                </Button>
            </div>
            {manageRow}
        </div>
    );
}

/** Paste-or-file upload/replace form. Text-first: .txt/.md read directly;
 *  .pdf/.docx go through the SAME mechanical (no-AI) server extractors the
 *  resume builder's import modal uses (extract-file-text.ts). No "Structure
 *  with AI" step — shipping without one is acceptable v1 per the binding
 *  no-AI-on-this-path rule; wiring one in later means an explicit,
 *  reviewed opt-in step, never automatic. */
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
                className="min-h-[160px] font-sans text-sm"
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
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy} className="gap-1.5">
                    <Upload size={14} />
                    {extracting ? "Reading…" : "Choose file"}
                </Button>
                {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
                <Button size="sm" disabled={busy || !text.trim()} onClick={handleSave}>
                    {pending ? "Saving…" : "Save"}
                </Button>
                {showCancel && (
                    <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                        Cancel
                    </Button>
                )}
            </div>
        </div>
    );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CircleNotch, DownloadSimple, FileText, Trash } from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/export-utils";
import { renderResumePdf, deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { tailoredVersionToResumeData } from "@/lib/resume/tailored-version";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import {
    fetchTailoredVersionsAction,
    fetchTailoredVersionAction,
    deleteTailoredVersionAction,
    type TailoredVersionSummary,
} from "@/actions/tailor-resume";

/**
 * The row only has the lean list shape, so a real PDF needs the full record
 * first — one fetch (`fetchTailoredVersionAction`, ownership-checked
 * server-side), then the SAME renderer everywhere else in the app uses
 * (reached the way `src/lib/pursuits/download-resume.ts:28` reaches it) —
 * never a second PDF path. Profile/education are always the original halves
 * (A2 rule 3: never sent to the model, never tailored); summary/experience/
 * competencies are the tailored halves, already degraded server-side to the
 * original where a version predates that field.
 */
async function downloadTailoredVersionPdf(id: string): Promise<void> {
    const res = await fetchTailoredVersionAction(id);
    if (res.error || !res.data) {
        throw new Error(res.error || "Couldn't load this version");
    }
    const detail = res.data;
    const resumeData = tailoredVersionToResumeData(detail);
    const filename = deriveResumePdfFilename({
        company: detail.companyName,
        role: detail.positionTitle,
        fallbackLabel: detail.versionName,
        dateIso: detail.updatedAt ?? detail.createdAt ?? new Date().toISOString(),
    });
    downloadBlob(renderResumePdf(resumeDataToParsedDocument(resumeData)), `${filename}.pdf`, "application/pdf");
}

function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function VersionRow({
    version,
    confirming,
    onConfirmDelete,
    onCancelDelete,
    onDelete,
    deleting,
    downloading,
    onDownload,
}: {
    version: TailoredVersionSummary;
    confirming: boolean;
    onConfirmDelete: () => void;
    onCancelDelete: () => void;
    onDelete: () => void;
    deleting: boolean;
    downloading: boolean;
    onDownload: () => void;
}) {
    const date = formatDate(version.updatedAt ?? version.createdAt);
    const changeLabel = `${version.recommendationCount} change${version.recommendationCount === 1 ? "" : "s"}`;

    return (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                    {version.companyName} · {version.positionTitle}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    {[date, changeLabel].filter(Boolean).join(" · ")}
                </p>
            </div>

            {confirming ? (
                <InlineConfirm
                    prompt="Delete this version?"
                    busy={deleting}
                    busyLabel="Deleting…"
                    onConfirm={onDelete}
                    onCancel={onCancelDelete}
                />
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm" className="rounded-none text-xs">
                        <Link href={`/resume?v=${version.id}`}>Open</Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={downloading}
                        onClick={onDownload}
                        className="rounded-none text-xs gap-1.5"
                    >
                        {downloading ? (
                            <CircleNotch size={13} className="animate-spin" />
                        ) : (
                            <DownloadSimple size={13} />
                        )}
                        {downloading ? "Preparing…" : "Download PDF"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onConfirmDelete}
                        className="rounded-none text-xs text-destructive hover:text-destructive"
                    >
                        <Trash size={13} />
                    </Button>
                </div>
            )}
        </div>
    );
}

export function TailoredVersionsList({
    /** Fixture/test seam: when supplied, the fetch is skipped and these rows
     *  render directly (used by `/mock/resume-versions`; also makes this
     *  component unit-testable without mocking the server action). The
     *  default (omitted) path is unchanged — it always fetches. */
    initialVersions,
}: { initialVersions?: TailoredVersionSummary[] } = {}) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">(initialVersions ? "ready" : "loading");
    const [versions, setVersions] = useState<TailoredVersionSummary[]>(initialVersions ?? []);
    const [retryToken, setRetryToken] = useState(0);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [deleting, startDeleteTransition] = useTransition();

    useEffect(() => {
        if (initialVersions) return;
        let cancelled = false;
        (async () => {
            setStatus("loading");
            const res = await fetchTailoredVersionsAction();
            if (cancelled) return;
            if (res.error || !res.data) {
                setStatus("error");
                return;
            }
            setVersions(res.data);
            setStatus("ready");
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- initialVersions is a fixture prop, not a reactive dep
    }, [retryToken]);

    const handleDelete = (id: string) => {
        startDeleteTransition(async () => {
            const res = await deleteTailoredVersionAction(id);
            if (res.error) {
                toast.error(res.error);
                return;
            }
            setVersions((prev) => prev.filter((v) => v.id !== id));
            setConfirmingId(null);
            toast.success("Version deleted");
        });
    };

    const handleDownload = async (id: string) => {
        setDownloadingId(id);
        try {
            await downloadTailoredVersionPdf(id);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't download this version");
        } finally {
            setDownloadingId(null);
        }
    };

    return (
        <section className="pt-6 border-t border-border">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] mb-1">Tailored versions</h2>
            <p className="text-[13px] text-muted-foreground mb-4">
                Resumes you tailored for a specific role from the apply dialog.
            </p>

            {status === "loading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CircleNotch size={16} className="animate-spin" />
                    Loading...
                </div>
            )}

            {status === "error" && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load your tailored versions.</p>
                    <Button variant="outline" size="sm" onClick={() => setRetryToken((t) => t + 1)}>
                        Try again
                    </Button>
                </div>
            )}

            {status === "ready" && versions.length === 0 && (
                <div className="space-y-3 rounded-none border border-dashed border-border bg-card p-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground">
                        <FileText size={24} />
                    </div>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        No tailored versions yet. When you apply to a role, you can tailor your resume for it from
                        the apply dialog.
                    </p>
                </div>
            )}

            {status === "ready" && versions.length > 0 && (
                <div className="divide-y divide-border rounded-none border border-border bg-card">
                    {versions.map((v) => (
                        <VersionRow
                            key={v.id}
                            version={v}
                            confirming={confirmingId === v.id}
                            onConfirmDelete={() => setConfirmingId(v.id)}
                            onCancelDelete={() => setConfirmingId(null)}
                            onDelete={() => handleDelete(v.id)}
                            deleting={deleting}
                            downloading={downloadingId === v.id}
                            onDownload={() => void handleDownload(v.id)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

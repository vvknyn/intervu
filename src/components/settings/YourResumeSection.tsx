"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CircleNotch } from "@phosphor-icons/react";
import type { User } from "@/lib/firebase/client-auth";
import { fetchResumeSummaryAction, type ResumeSummary } from "@/actions/resume-summary";

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
function downloadBlob(content: string, filename: string, type: string) {
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

/**
 * Read-only mirror of the SAME base résumé `getBaseResumeForUser`
 * canonicalizes for the `get_resume`/`set_resume` MCP tools and the resume
 * builder — no editing, no AI features here (see McpHandoffNote for the
 * "your AI does this" pointer used elsewhere in Settings). Mirrors
 * AgentPreferencesSection's section shape and load-retry pattern.
 */
export function YourResumeSection({ user, onLoginClick, embedded }: YourResumeSectionProps) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    // Bumped by the "Try again" button to re-run the same effect below —
    // one fetch-with-retry implementation instead of a duplicate copy for
    // the manual-retry path.
    const [retryToken, setRetryToken] = useState(0);

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

            {status === "ready" && summary && <ResumeSummaryBody summary={summary} />}
        </section>
    );
}

function ResumeSummaryBody({ summary }: { summary: ResumeSummary }) {
    const updatedLabel = formatDate(summary.updatedAt);

    if (summary.source === "none") {
        return (
            <p className="text-sm text-muted-foreground">
                No resume yet — send one to your agent on WhatsApp, or your agent can build one with you.
            </p>
        );
    }

    if (summary.source === "resume_text") {
        const preview = summary.resume_text.split("\n").slice(0, TEXT_PREVIEW_LINES).join("\n");
        return (
            <div className="space-y-3">
                {updatedLabel && <p className="text-xs text-muted-foreground">Last updated {updatedLabel}</p>}
                <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/30 border border-border rounded-none p-3 max-h-80 overflow-y-auto">
                    {preview}
                </pre>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadBlob(summary.resume_text, "resume.txt", "text/plain")}
                >
                    Download .txt
                </Button>
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
            <Button
                variant="outline"
                size="sm"
                onClick={() => downloadBlob(JSON.stringify(summary.resume_data, null, 2), "resume.json", "application/json")}
            >
                Download .json
            </Button>
        </div>
    );
}

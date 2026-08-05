"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { orderResumeVersionsLatestFirst } from "@/lib/pursuits/types";
import {
    TRACKER_DETAIL_STAGES,
    TRACKER_SHEET_BOTTOM,
    daysInTracker,
    hasResumeLinked,
} from "@/lib/pursuits/tracker-display";
import { downloadResumeVersion } from "@/lib/pursuits/download-resume";

interface PursuitDetailSheetProps {
    pursuit: Pursuit | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStatusChange: (status: PursuitStage) => Promise<void>;
    onNoteSave: (note: string) => Promise<void>;
    onRemove: () => Promise<void>;
    saving?: boolean;
}

const fieldClass =
    "border-transparent bg-muted focus-visible:border-[#c5ccd6] focus-visible:bg-background";

export function PursuitDetailSheet({
    pursuit,
    open,
    onOpenChange,
    onStatusChange,
    onNoteSave,
    onRemove,
    saving,
}: PursuitDetailSheetProps) {
    if (!pursuit) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                hideCloseButton
                className={cn(
                    "mx-auto max-h-[min(88vh,760px)] max-w-[720px] overflow-y-auto rounded-t-[18px] border-b-0 p-0",
                    TRACKER_SHEET_BOTTOM,
                )}
            >
                <PursuitDetailBody
                    key={`${pursuit.id}:${pursuit.note ?? ""}`}
                    pursuit={pursuit}
                    onStatusChange={onStatusChange}
                    onNoteSave={onNoteSave}
                    onRemove={onRemove}
                    saving={saving}
                />
            </SheetContent>
        </Sheet>
    );
}

function PursuitDetailBody({
    pursuit,
    onStatusChange,
    onNoteSave,
    onRemove,
    saving,
}: {
    pursuit: Pursuit;
    onStatusChange: (status: PursuitStage) => Promise<void>;
    onNoteSave: (note: string) => Promise<void>;
    onRemove: () => Promise<void>;
    saving?: boolean;
}) {
    const [note, setNote] = useState(pursuit.note ?? "");
    const latestResume = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? [])[0];
    const resumeLabel = latestResume?.label ?? pursuit.resume_version?.version_name;
    const days = daysInTracker(pursuit);

    return (
        <>
            <div className="flex justify-center pb-1 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-[#d0d6de]" aria-hidden="true" />
            </div>
            <SheetHeader className="space-y-0 border-b border-border px-5 pb-3.5 pt-1 text-left">
                <SheetTitle className="text-lg font-semibold tracking-[-0.03em]">{pursuit.position}</SheetTitle>
                <SheetDescription className="text-[13px]">{pursuit.company_name}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-5 py-4 pb-7">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
                    {TRACKER_DETAIL_STAGES.map(({ stage, label }) => {
                        const pressed =
                            stage === "interested"
                                ? pursuit.status === "interested" || pursuit.status === "resume_ready"
                                : pursuit.status === stage;
                        return (
                            <button
                                key={stage}
                                type="button"
                                aria-pressed={pressed}
                                disabled={saving}
                                onClick={() => void onStatusChange(stage)}
                                className={cn(
                                    "rounded-full border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground transition-colors",
                                    pressed && "border-foreground bg-foreground text-background",
                                )}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-muted p-3.5">
                    <div>
                        <dt className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#8b939e]">In tracker</dt>
                        <dd className="text-[13px]">{days}d</dd>
                    </div>
                    <div>
                        <dt className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#8b939e]">Resume</dt>
                        <dd className="text-[13px]">{resumeLabel ?? "— none linked"}</dd>
                    </div>
                </dl>

                <div>
                    <Label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.07em] text-[#8b939e]">Note</Label>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={fieldClass} />
                </div>

                <div className="flex flex-wrap gap-2">
                    {pursuit.job_url && (
                        <Button asChild>
                            <a href={pursuit.job_url} target="_blank" rel="noopener noreferrer">
                                Open posting
                            </a>
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        disabled={!latestResume}
                        onClick={() => latestResume && downloadResumeVersion(latestResume, pursuit)}
                    >
                        Download resume
                    </Button>
                    <Button variant="outline" disabled={saving} onClick={() => void onNoteSave(note.trim())}>
                        Save note
                    </Button>
                    <Button
                        variant="outline"
                        disabled={saving}
                        className="text-[#8a3a3a] hover:text-[#8a3a3a]"
                        onClick={() => void onRemove()}
                    >
                        Remove
                    </Button>
                </div>
                {!hasResumeLinked(pursuit) && (
                    <p className="text-[12px] text-muted-foreground">No resume version on file for this application.</p>
                )}
            </div>
        </>
    );
}

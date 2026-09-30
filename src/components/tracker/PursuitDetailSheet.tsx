"use client";

import { useState } from "react";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetHandle, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { orderResumeVersionsLatestFirst } from "@/lib/pursuits/types";
import { LandedPledgeForPursuit } from "@/components/tracker/LandedPledgePanel";
import {
    TRACKER_SHEET_BOTTOM,
    daysInTracker,
    daysSinceUpdate,
    hasResumeLinked,
    isStalePursuit,
} from "@/lib/pursuits/tracker-display";
import { downloadResumeVersion } from "@/lib/pursuits/download-resume";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import { TRACKER_FIELD_CLASS } from "@/components/tracker/field-class";
import { PursuitStatusPicker } from "@/components/tracker/PursuitStatusPicker";
import { PursuitNoteField } from "@/components/tracker/PursuitNoteField";

interface PursuitDetailSheetProps {
    pursuit: Pursuit | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStatusChange: (status: PursuitStage) => Promise<void>;
    onNoteSave: (note: string) => Promise<void>;
    onInterviewDateSave: (interviewDate: string) => Promise<void>;
    onRemove: () => Promise<void>;
    saving?: boolean;
}

export function PursuitDetailSheet({
    pursuit,
    open,
    onOpenChange,
    onStatusChange,
    onNoteSave,
    onInterviewDateSave,
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
                    "mx-auto max-h-[min(760px,var(--overlay-max-h))] max-w-[720px] gap-0 rounded-t-panel border-b-0 p-0",
                    TRACKER_SHEET_BOTTOM,
                )}
            >
                <PursuitDetailBody
                    // Not keyed on the note: each autosave changed the key, remounted
                    // the body and dropped focus mid-typing, so the rest was lost.
                    key={`${pursuit.id}:${pursuit.interview_date ?? ""}`}
                    pursuit={pursuit}
                    onStatusChange={onStatusChange}
                    onNoteSave={onNoteSave}
                    onInterviewDateSave={onInterviewDateSave}
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
    onInterviewDateSave,
    onRemove,
    saving,
}: {
    pursuit: Pursuit;
    onStatusChange: (status: PursuitStage) => Promise<void>;
    onNoteSave: (note: string) => Promise<void>;
    onInterviewDateSave: (interviewDate: string) => Promise<void>;
    onRemove: () => Promise<void>;
    saving?: boolean;
}) {
    const [interviewDate, setInterviewDate] = useState(() =>
        pursuit.interview_date ? pursuit.interview_date.slice(0, 10) : "",
    );
    const latestResume = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? [])[0];
    const resumeLabel = latestResume?.label ?? pursuit.resume_version?.version_name;
    const days = daysInTracker(pursuit);
    const stale = isStalePursuit(pursuit);

    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    // Two-step inline confirm — the same shared shape `YourResumeSection`'s
    // delete-resume flow already uses, rather than a third destructive-action
    // pattern (`confirmToast`) for one more surface.
    const handleRemove = async () => {
        setRemoving(true);
        try {
            await onRemove();
        } finally {
            setRemoving(false);
            setConfirmingRemove(false);
        }
    };

    return (
        <>
            <div className="shrink-0 border-b border-border">
                <div className="flex justify-center pb-1 pt-2.5">
                    <SheetHandle className="h-1 w-9" />
                </div>
                <div className="flex items-start gap-1 px-5 pb-3.5 pt-1">
                    <SheetHeader className="min-w-0 flex-1 space-y-0 text-left">
                        <SheetTitle className="line-clamp-2 text-lg font-semibold leading-snug">{pursuit.position}</SheetTitle>
                        <SheetDescription className="truncate text-meta">{pursuit.company_name}</SheetDescription>
                    </SheetHeader>
                    <SheetClose className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground transition-opacity hover:opacity-80">
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">Close</span>
                    </SheetClose>
                </div>
            </div>
            <SheetBody className="space-y-4 px-5 py-4 pb-7">
                <PursuitStatusPicker status={pursuit.status} disabled={saving} onChange={(stage) => void onStatusChange(stage)} />

                {/* The pay-when-you-land moment (strategy decision 7): only once
                    the pursuit sits in the Offer lane. */}
                <LandedPledgeForPursuit pursuit={pursuit} />

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-panel border border-border bg-surface-2 p-3.5 shadow-[var(--shadow-bevel-inset)]">
                    <div>
                        <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">In tracker</dt>
                        <dd className="text-xl font-semibold tabular-nums">{days}d</dd>
                    </div>
                    <div>
                        <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">Resume</dt>
                        <dd className="text-meta">{resumeLabel ?? "— none linked"}</dd>
                    </div>
                    {stale && (
                        <div className="col-span-2">
                            <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">Update</dt>
                            <dd className="text-meta">no update in {daysSinceUpdate(pursuit)}d</dd>
                        </div>
                    )}
                </dl>

                {/* Notes used to be lost on close; the field flushes on unmount (spec B1). */}
                <PursuitNoteField initialNote={pursuit.note ?? ""} onSave={onNoteSave} />

                <div>
                    <Label className="mb-1.5 block whitespace-nowrap text-xs text-muted-foreground">
                        Interview date
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            type="date"
                            value={interviewDate}
                            onChange={(e) => setInterviewDate(e.target.value)}
                            className={cn("w-auto", TRACKER_FIELD_CLASS)}
                            aria-label="Interview date"
                        />
                        <Button
                            variant="outline"
                            disabled={saving || !interviewDate}
                            onClick={() => void onInterviewDateSave(interviewDate)}
                        >
                            Set interview date
                        </Button>
                    </div>
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
                        onClick={() => latestResume && void downloadResumeVersion(latestResume, pursuit)}
                    >
                        Download resume
                    </Button>
                    {!confirmingRemove && (
                        <Button
                            variant="outline"
                            disabled={saving}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmingRemove(true)}
                        >
                            Remove
                        </Button>
                    )}
                </div>
                {confirmingRemove && (
                    <InlineConfirm
                        prompt={`Remove ${pursuit.position} at ${pursuit.company_name}?`}
                        confirmLabel="Remove"
                        busyLabel="Removing…"
                        busy={removing}
                        onConfirm={() => void handleRemove()}
                        onCancel={() => setConfirmingRemove(false)}
                    />
                )}
                {!hasResumeLinked(pursuit) && (
                    <p className="text-xs text-muted-foreground">No resume version on file for this application.</p>
                )}
            </SheetBody>
        </>
    );
}

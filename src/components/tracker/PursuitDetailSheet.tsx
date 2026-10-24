"use client";

import { useState } from "react";
import { Sheet, SheetBar, SheetBody, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { orderResumeVersionsLatestFirst } from "@/lib/pursuits/types";
import {
    TRACKER_SHEET_BOTTOM,
    daysInTracker,
    daysSinceUpdate,
    isStalePursuit,
} from "@/lib/pursuits/tracker-display";
import { downloadResumeVersion } from "@/lib/pursuits/download-resume";
import { downloadAppliedResume } from "@/lib/pursuits/applied-resume-client";
import { APPLIED_RESUME_LABEL } from "@/lib/pursuits/resume-on-apply";
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
    /** Takes the résumé copied on at Applied off the role; true once it's gone. */
    onRemoveAppliedResume: () => Promise<boolean>;
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
    onRemoveAppliedResume,
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
                    onRemoveAppliedResume={onRemoveAppliedResume}
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
    onRemoveAppliedResume,
    saving,
}: {
    pursuit: Pursuit;
    onStatusChange: (status: PursuitStage) => Promise<void>;
    onNoteSave: (note: string) => Promise<void>;
    onInterviewDateSave: (interviewDate: string) => Promise<void>;
    onRemove: () => Promise<void>;
    onRemoveAppliedResume: () => Promise<boolean>;
    saving?: boolean;
}) {
    const [interviewDate, setInterviewDate] = useState(() =>
        pursuit.interview_date ? pursuit.interview_date.slice(0, 10) : "",
    );
    const latestResume = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? [])[0];
    // A version filed for the role (by an agent) is what went out; otherwise
    // the résumé copied on when it was marked Applied.
    const appliedResume = latestResume ? undefined : pursuit.applied_resume;
    const resumeLabel = latestResume?.label ?? (appliedResume ? APPLIED_RESUME_LABEL : pursuit.resume_version?.version_name);
    const days = daysInTracker(pursuit);
    const stale = isStalePursuit(pursuit);

    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [confirmingResumeRemove, setConfirmingResumeRemove] = useState(false);
    const [removingResume, setRemovingResume] = useState(false);

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

    const handleResumeRemove = async () => {
        setRemovingResume(true);
        try {
            if (await onRemoveAppliedResume()) setConfirmingResumeRemove(false);
        } finally {
            setRemovingResume(false);
        }
    };

    return (
        <>
            <SheetBar title={pursuit.position} description={pursuit.company_name} />
            <SheetBody className="space-y-4 px-4 py-4 pb-7">
                <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Status</p>
                    <PursuitStatusPicker status={pursuit.status} disabled={saving} onChange={(stage) => void onStatusChange(stage)} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-panel border border-border bg-surface-2 p-3.5 shadow-[var(--shadow-bevel-inset)]">
                    <div>
                        <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">In tracker</dt>
                        <dd className="text-xl font-semibold tabular-nums">{days}d</dd>
                    </div>
                    {/* A web user saw "none linked" and a dead Download button on
                        every role (journey audit 2026-09-30), so both show only
                        with a résumé: one an agent filed, or the copy taken when
                        the role was marked Applied. */}
                    {resumeLabel && (
                        <div>
                            <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">Resume</dt>
                            <dd className="text-meta">
                                {resumeLabel}
                                {appliedResume && !confirmingResumeRemove && (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmingResumeRemove(true)}
                                        className="mt-1 block text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                                    >
                                        Remove résumé
                                    </button>
                                )}
                            </dd>
                        </div>
                    )}
                    {stale && (
                        <div className="col-span-2">
                            <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">Update</dt>
                            <dd className="text-meta">no update in {daysSinceUpdate(pursuit)}d</dd>
                        </div>
                    )}
                </dl>
                {confirmingResumeRemove && (
                    <InlineConfirm
                        prompt="Remove this copy from the role? Your résumé itself stays."
                        confirmLabel="Remove résumé"
                        busyLabel="Removing…"
                        busy={removingResume}
                        onConfirm={() => void handleResumeRemove()}
                        onCancel={() => setConfirmingResumeRemove(false)}
                    />
                )}

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
                    {latestResume ? (
                        <Button variant="outline" onClick={() => void downloadResumeVersion(latestResume, pursuit)}>
                            Download resume
                        </Button>
                    ) : appliedResume ? (
                        <Button variant="outline" onClick={() => void downloadAppliedResume(pursuit)}>
                            Download resume
                        </Button>
                    ) : null}
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
            </SheetBody>
        </>
    );
}

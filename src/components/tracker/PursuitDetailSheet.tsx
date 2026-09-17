"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHandle, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { orderResumeVersionsLatestFirst } from "@/lib/pursuits/types";
import {
    TRACKER_LANE_STAGES,
    TRACKER_SHEET_BOTTOM,
    daysInTracker,
    daysSinceUpdate,
    hasResumeLinked,
    isActiveTrackerLaneStage,
    isStalePursuit,
} from "@/lib/pursuits/tracker-display";
import { downloadResumeVersion } from "@/lib/pursuits/download-resume";
import { NoteAutosave } from "@/lib/pursuits/note-autosave";
import { InlineConfirm } from "@/components/ui/inline-confirm";

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

const fieldClass =
    "border-transparent bg-muted focus-visible:border-border-strong focus-visible:bg-background";

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
                    "mx-auto max-h-[min(88dvh,760px)] max-w-[720px] overflow-y-auto rounded-none border-b-0 p-0",
                    TRACKER_SHEET_BOTTOM,
                )}
            >
                <PursuitDetailBody
                    key={`${pursuit.id}:${pursuit.note ?? ""}:${pursuit.interview_date ?? ""}`}
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
    const [note, setNote] = useState(pursuit.note ?? "");
    const [noteIndicator, setNoteIndicator] = useState<"saving" | "saved" | null>(null);
    const [interviewDate, setInterviewDate] = useState(() =>
        pursuit.interview_date ? pursuit.interview_date.slice(0, 10) : "",
    );
    const latestResume = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? [])[0];
    const resumeLabel = latestResume?.label ?? pursuit.resume_version?.version_name;
    const days = daysInTracker(pursuit);
    const stale = isStalePursuit(pursuit);

    // `onNoteSave` is a fresh closure every render of the parent (yours/page
    // .tsx builds it inline) — capture it in a ref so the autosave engine
    // below (constructed once, lazily) always calls the latest version
    // rather than whatever was current at construction time.
    const onNoteSaveRef = useRef(onNoteSave);
    onNoteSaveRef.current = onNoteSave;
    const noteRef = useRef(note);
    noteRef.current = note;

    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    const noteAutosaveRef = useRef<NoteAutosave | null>(null);
    if (!noteAutosaveRef.current) {
        noteAutosaveRef.current = new NoteAutosave((value) => {
            setNoteIndicator("saving");
            void onNoteSaveRef.current(value.trim()).then(
                () => setNoteIndicator("saved"),
                () => setNoteIndicator(null),
            );
        });
    }

    // Flush pending edits when this sheet instance closes (this component
    // unmounts — the parent's onOpenChange clears the selected pursuit in
    // the same update, so there's no intermediate "open flips false while
    // still mounted" render to hook) or the tab is about to unload. Notes
    // used to be silently lost on close; this is the fix (spec B1).
    useEffect(() => {
        const flush = () => noteAutosaveRef.current?.flush(noteRef.current);
        window.addEventListener("beforeunload", flush);
        return () => {
            window.removeEventListener("beforeunload", flush);
            flush();
        };
    }, []);

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
                        <SheetTitle className="truncate text-lg font-semibold">{pursuit.position}</SheetTitle>
                        <SheetDescription className="truncate text-meta">{pursuit.company_name}</SheetDescription>
                    </SheetHeader>
                    <SheetClose className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground transition-opacity hover:opacity-80">
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">Close</span>
                    </SheetClose>
                </div>
            </div>
            <div className="space-y-4 px-5 py-4 pb-7">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
                    {TRACKER_LANE_STAGES.map(({ stage, label }) => {
                        const pressed = isActiveTrackerLaneStage(pursuit.status, stage);
                        return (
                            <button
                                key={stage}
                                type="button"
                                aria-pressed={pressed}
                                disabled={saving}
                                onClick={() => void onStatusChange(stage)}
                                className={cn(
                                    "whitespace-nowrap rounded-none border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors",
                                    pressed && "border-primary bg-primary text-primary-foreground",
                                )}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-none bg-muted p-3.5">
                    <div>
                        <dt className="mb-1 whitespace-nowrap text-xs text-muted-foreground">In tracker</dt>
                        <dd className="text-meta">{days}d</dd>
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

                <div>
                    <div className="mb-1.5 flex items-center justify-between">
                        <Label className="block whitespace-nowrap text-xs text-muted-foreground">Note</Label>
                        {noteIndicator && (
                            <span className="text-xs text-muted-foreground" aria-live="polite">
                                {noteIndicator === "saving" ? "saving…" : "saved"}
                            </span>
                        )}
                    </div>
                    <Textarea
                        value={note}
                        onChange={(e) => {
                            setNote(e.target.value);
                            noteAutosaveRef.current?.edit(e.target.value);
                        }}
                        rows={2}
                        className={fieldClass}
                    />
                </div>

                <div>
                    <Label className="mb-1.5 block whitespace-nowrap text-xs text-muted-foreground">
                        Interview date
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            type="date"
                            value={interviewDate}
                            onChange={(e) => setInterviewDate(e.target.value)}
                            className={cn("w-auto", fieldClass)}
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
            </div>
        </>
    );
}

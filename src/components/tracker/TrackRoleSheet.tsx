"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHandle, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CircleNotch } from "@phosphor-icons/react";
import type { PursuitStage } from "@/lib/pursuits/types";
import { TRACKER_LANE_STAGES, TRACKER_SHEET_BOTTOM } from "@/lib/pursuits/tracker-display";

export interface TrackRoleDraft {
    company: string;
    position: string;
    job_url: string;
    status: PursuitStage;
    note: string;
}

interface TrackRoleSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (draft: TrackRoleDraft) => Promise<void>;
    saving?: boolean;
}

const fieldClass =
    "border-transparent bg-muted focus-visible:border-border-strong focus-visible:bg-background";

export function TrackRoleSheet({ open, onOpenChange, onSave, saving }: TrackRoleSheetProps) {
    const [company, setCompany] = useState("");
    const [position, setPosition] = useState("");
    const [jobUrl, setJobUrl] = useState("");
    const [status, setStatus] = useState<PursuitStage>("applied");
    const [note, setNote] = useState("");

    const reset = () => {
        setCompany("");
        setPosition("");
        setJobUrl("");
        setStatus("applied");
        setNote("");
    };

    const handleSave = async () => {
        if (!company.trim() || !position.trim()) return;
        await onSave({
            company: company.trim(),
            position: position.trim(),
            job_url: jobUrl.trim(),
            status,
            note: note.trim(),
        });
        reset();
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) reset();
                onOpenChange(next);
            }}
        >
            <SheetContent
                side="bottom"
                hideCloseButton
                className={cn(
                    "mx-auto max-h-[min(88dvh,760px)] max-w-[720px] overflow-y-auto rounded-none border-b-0 p-0",
                    TRACKER_SHEET_BOTTOM,
                )}
            >
                <div className="shrink-0 border-b border-border">
                    <div className="flex justify-center pb-1 pt-2.5">
                        <SheetHandle className="h-1 w-9" />
                    </div>
                    <div className="flex items-start gap-1 px-5 pb-3.5 pt-1">
                        <SheetHeader className="min-w-0 flex-1 space-y-0 text-left">
                            <SheetTitle className="truncate text-lg font-semibold">Track a role</SheetTitle>
                            <SheetDescription className="truncate text-xs">One step. Link the posting — skip the essay.</SheetDescription>
                        </SheetHeader>
                        <SheetClose className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground transition-opacity hover:opacity-80">
                            <span aria-hidden="true">×</span>
                            <span className="sr-only">Close</span>
                        </SheetClose>
                    </div>
                </div>
                <div className="space-y-3 px-5 py-4 pb-7">
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Company</Label>
                        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" className={fieldClass} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Role</Label>
                        <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Staff Software Engineer" className={fieldClass} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Job URL</Label>
                        <Input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://boards.greenhouse.io/…" className={fieldClass} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Status</Label>
                        <Select value={status} onValueChange={(v) => setStatus(v as PursuitStage)}>
                            <SelectTrigger className={fieldClass}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TRACKER_LANE_STAGES.map(({ stage, label }) => (
                                    <SelectItem key={stage} value={stage}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Note (optional)</Label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="Recruiter name, referral…"
                            className={fieldClass}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button onClick={() => void handleSave()} disabled={saving || !company.trim() || !position.trim()}>
                            {saving && <CircleNotch className="mr-2 animate-spin" />}
                            {saving ? "Saving…" : "Save to tracker"}
                        </Button>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}

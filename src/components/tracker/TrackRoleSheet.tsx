"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetBar, SheetBody, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineSpinner } from "@/components/ui/wait-state";
import type { PursuitStage } from "@/lib/pursuits/types";
import { TRACKER_STATUS_OPTIONS } from "@/lib/pursuits/tracker-display";
import { TRACKER_FIELD_CLASS } from "@/components/tracker/field-class";
import { APPLICATION_FIELD_MAX } from "@/lib/validation";

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
                className="mx-auto max-h-[min(760px,var(--overlay-max-h))] max-w-[720px] gap-0 rounded-t-panel border-b-0 p-0"
            >
                <SheetBar title="Track a role" description="One step. Link the posting — skip the essay." />
                <SheetBody className="space-y-3 px-4 py-4 pb-7">
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Company</Label>
                        <Input value={company} maxLength={APPLICATION_FIELD_MAX.company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" className={TRACKER_FIELD_CLASS} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Role</Label>
                        <Input value={position} maxLength={APPLICATION_FIELD_MAX.position} onChange={(e) => setPosition(e.target.value)} placeholder="Staff Software Engineer" className={TRACKER_FIELD_CLASS} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Job URL</Label>
                        <Input value={jobUrl} maxLength={APPLICATION_FIELD_MAX.url} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://boards.greenhouse.io/…" className={TRACKER_FIELD_CLASS} />
                    </div>
                    <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">Status</Label>
                        <Select value={status} onValueChange={(v) => setStatus(v as PursuitStage)}>
                            <SelectTrigger className={TRACKER_FIELD_CLASS}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TRACKER_STATUS_OPTIONS.map(({ stage, label }) => (
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
                            maxLength={APPLICATION_FIELD_MAX.note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="Recruiter name, referral…"
                            className={TRACKER_FIELD_CLASS}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button onClick={() => void handleSave()} disabled={saving || !company.trim() || !position.trim()}>
                            {saving && <InlineSpinner className="mr-2" />}
                            {saving ? "Saving…" : "Save to tracker"}
                        </Button>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                    </div>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

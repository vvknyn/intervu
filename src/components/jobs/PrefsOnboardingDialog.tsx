"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipVariants } from "@/components/ui/chip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { EXPERIENCE_LEVELS, WORK_TYPES, type ExperienceLevel, type WorkType } from "@/lib/agent/facets";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import type { SearchPreferences } from "@/lib/agent/preferences";

interface PrefsOnboardingDialogProps {
    open: boolean;
    draft: SearchPreferences;
    onSave: (search: SearchPreferences) => Promise<void>;
    onDismiss: () => void | Promise<void>;
}

/**
 * One-shot dialog for first-time personalization — prefilled from résumé,
 * not a full settings form. Save or Skip marks onboarding complete; later
 * edits live in Settings → Job search.
 */
export function PrefsOnboardingDialog({ open, draft, onSave, onDismiss }: PrefsOnboardingDialogProps) {
    const [location, setLocation] = useState(draft.location ?? "");
    const [workMode, setWorkMode] = useState<WorkType | undefined>(draft.workMode);
    const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | undefined>(
        draft.experienceLevel as ExperienceLevel | undefined,
    );
    const [salaryMin, setSalaryMin] = useState(draft.salaryMin !== undefined ? String(draft.salaryMin) : "");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLocation(draft.location ?? "");
        setWorkMode(draft.workMode);
        setExperienceLevel(draft.experienceLevel as ExperienceLevel | undefined);
        setSalaryMin(draft.salaryMin !== undefined ? String(draft.salaryMin) : "");
    }, [open, draft]);

    const toggleWorkMode = (mode: WorkType) => {
        setWorkMode((current) => (current === mode ? undefined : mode));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const search: SearchPreferences = {
                location: location.trim() || undefined,
                workMode,
                remoteOnly: workMode === "remote" ? true : undefined,
                experienceLevel,
                salaryMin: salaryMin.trim() ? Number(salaryMin) : undefined,
            };
            await onSave(search);
        } finally {
            setSaving(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) void onDismiss();
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                data-testid="prefs-onboarding-dialog"
                className="z-[70] flex max-h-[85dvh] w-full max-w-[720px] flex-col overflow-hidden p-0 sm:max-w-xl"
            >
                <div className="flex min-h-0 max-h-[85dvh] flex-col">
                    <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
                        <DialogHeader className="space-y-1 text-left">
                            <DialogTitle className="text-base font-semibold leading-snug text-foreground">
                                Personalize your job feed
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Confirm a few defaults — we&apos;ll rank jobs for you automatically.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Input
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="Location"
                                className="h-9 max-w-[180px] rounded-none text-xs"
                            />
                            {WORK_TYPES.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => toggleWorkMode(mode)}
                                    className={chipVariants({ active: workMode === mode })}
                                >
                                    {facetValueLabel("work_type", mode)}
                                </button>
                            ))}
                            {EXPERIENCE_LEVELS.slice(0, 3).map((lvl) => (
                                <button
                                    key={lvl}
                                    type="button"
                                    onClick={() =>
                                        setExperienceLevel((current) => (current === lvl ? undefined : lvl))
                                    }
                                    className={chipVariants({ active: experienceLevel === lvl })}
                                >
                                    {facetValueLabel("experience_level", lvl)}
                                </button>
                            ))}
                            <Input
                                type="number"
                                min={0}
                                value={salaryMin}
                                onChange={(e) => setSalaryMin(e.target.value)}
                                placeholder="Min salary"
                                className="h-9 max-w-[120px] rounded-none text-xs"
                            />
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 rounded-none text-xs"
                            onClick={() => void onDismiss()}
                        >
                            Skip
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="h-9 rounded-none text-xs"
                            onClick={() => void handleSave()}
                            disabled={saving}
                        >
                            {saving ? "Saving…" : "Save & rank"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

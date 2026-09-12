"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipVariants } from "@/components/ui/chip";
import { EXPERIENCE_LEVELS, WORK_TYPES, type ExperienceLevel, type WorkType } from "@/lib/agent/facets";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import type { SearchPreferences } from "@/lib/agent/preferences";
import { X } from "@phosphor-icons/react";

interface PrefsOnboardingStripProps {
    draft: SearchPreferences;
    onSave: (search: SearchPreferences) => Promise<void>;
    onDismiss: () => void;
}

/**
 * Compact chip strip for first-time personalization — prefilled from résumé,
 * not a full settings form. Saves via `agent_preferences` server action.
 */
export function PrefsOnboardingStrip({ draft, onSave, onDismiss }: PrefsOnboardingStripProps) {
    const [location, setLocation] = useState(draft.location ?? "");
    const [workMode, setWorkMode] = useState<WorkType | undefined>(draft.workMode);
    const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | undefined>(
        draft.experienceLevel as ExperienceLevel | undefined,
    );
    const [salaryMin, setSalaryMin] = useState(draft.salaryMin !== undefined ? String(draft.salaryMin) : "");
    const [saving, setSaving] = useState(false);

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

    return (
        <div
            data-testid="prefs-onboarding-strip"
            className="mt-3 rounded-none border border-border bg-card p-3 text-sm"
        >
            <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-foreground">Personalize your job feed</p>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss"
                >
                    <X size={16} />
                </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                Confirm a few defaults — we&apos;ll rank jobs for you automatically.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Location"
                    className="h-8 max-w-[180px] text-xs"
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
                    className="h-8 max-w-[120px] text-xs"
                />
            </div>
            <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                    Not now
                </Button>
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving…" : "Save & rank"}
                </Button>
            </div>
        </div>
    );
}

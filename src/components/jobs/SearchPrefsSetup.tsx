"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { saveAgentPreferencesAction } from "@/actions/agent-preferences";

export interface SearchPrefsValues {
    query: string;
    location: string;
    remoteOnly: boolean;
    salaryMin: number;
}

export interface SearchPrefsSetupProps {
    variant: "inline" | "dialog";
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    initial?: Partial<SearchPrefsValues>;
    onComplete: (values: SearchPrefsValues) => void;
    onAddResume?: () => void;
}

const STEPS = ["Roles", "Location", "Preferences", "Résumé"] as const;

function StepIndicator({ step }: { step: number }) {
    return (
        <ol className="flex items-center gap-2" aria-label="Setup progress">
            {STEPS.map((label, i) => {
                const n = i + 1;
                const active = n === step;
                const done = n < step;
                return (
                    <li key={label} className="flex items-center gap-2">
                        <span
                            className={cn(
                                "inline-flex h-6 min-w-6 items-center justify-center rounded-none border px-1.5 text-[10px] font-bold uppercase tracking-wider",
                                active && "border-foreground bg-foreground text-background",
                                done && !active && "border-foreground/60 text-foreground",
                                !active && !done && "border-border text-muted-foreground",
                            )}
                            aria-current={active ? "step" : undefined}
                        >
                            {n}
                        </span>
                        <span
                            className={cn(
                                "hidden text-[10px] uppercase tracking-wider sm:inline",
                                active ? "font-bold text-foreground" : "text-muted-foreground",
                            )}
                        >
                            {label}
                        </span>
                        {i < STEPS.length - 1 ? (
                            <span className="hidden h-px w-3 bg-border sm:block" aria-hidden />
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}

function SearchPrefsForm({
    step,
    setStep,
    values,
    setValues,
    saving,
    onContinue,
    onFinish,
    onAddResume,
}: {
    step: number;
    setStep: (n: number) => void;
    values: SearchPrefsValues;
    setValues: (v: SearchPrefsValues) => void;
    saving: boolean;
    onContinue: () => void;
    onFinish: () => void;
    onAddResume: () => void;
}) {
    const queryValid = values.query.trim().length > 0;

    return (
        <div className="space-y-5">
            <StepIndicator step={step} />

            {step === 1 && (
                <div className="space-y-2">
                    <label htmlFor="search-prefs-query" className="text-xs font-bold uppercase tracking-wider text-foreground">
                        What roles are you looking for?
                    </label>
                    <Input
                        id="search-prefs-query"
                        data-testid="search-prefs-query"
                        value={values.query}
                        onChange={(e) => setValues({ ...values, query: e.target.value })}
                        placeholder="e.g. Software Engineer, Registered Nurse"
                        className="rounded-none"
                        autoFocus
                    />
                </div>
            )}

            {step === 2 && (
                <div className="space-y-2">
                    <label htmlFor="search-prefs-location" className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Where? <span className="font-normal normal-case tracking-normal text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                        id="search-prefs-location"
                        data-testid="search-prefs-location"
                        value={values.location}
                        onChange={(e) => setValues({ ...values, location: e.target.value })}
                        placeholder="City, state, or country"
                        className="rounded-none"
                        autoFocus
                    />
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                        <input
                            type="checkbox"
                            data-testid="search-prefs-remote"
                            checked={values.remoteOnly}
                            onChange={(e) => setValues({ ...values, remoteOnly: e.target.checked })}
                            className="h-4 w-4 rounded-none border-border"
                        />
                        Remote jobs only
                    </label>
                    <div className="space-y-2">
                        <label htmlFor="search-prefs-salary" className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Minimum salary <span className="font-normal normal-case tracking-normal text-muted-foreground">(optional)</span>
                        </label>
                        <Input
                            id="search-prefs-salary"
                            data-testid="search-prefs-salary"
                            type="number"
                            min={0}
                            step={1000}
                            value={values.salaryMin || ""}
                            onChange={(e) =>
                                setValues({
                                    ...values,
                                    salaryMin: e.target.value ? Number(e.target.value) : 0,
                                })
                            }
                            placeholder="e.g. 150000"
                            className="rounded-none"
                        />
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Add your résumé to rank jobs by fit, or skip and browse with your search.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="search-prefs-skip"
                            disabled={saving}
                            onClick={onFinish}
                            className="rounded-none"
                        >
                            Skip
                        </Button>
                        <Button
                            type="button"
                            data-testid="search-prefs-add-resume"
                            disabled={saving}
                            onClick={onAddResume}
                            className="rounded-none"
                        >
                            Add résumé
                        </Button>
                    </div>
                </div>
            )}

            {step < 4 && (
                <Button
                    type="button"
                    data-testid="search-prefs-continue"
                    disabled={saving || (step === 1 && !queryValid)}
                    onClick={onContinue}
                    className="rounded-none"
                >
                    {step === 3 ? "Show jobs" : "Continue"}
                </Button>
            )}
        </div>
    );
}

export function SearchPrefsSetup({
    variant,
    open = false,
    onOpenChange,
    initial,
    onComplete,
    onAddResume,
}: SearchPrefsSetupProps) {
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);
    const [values, setValues] = useState<SearchPrefsValues>({
        query: initial?.query ?? "",
        location: initial?.location ?? "",
        remoteOnly: initial?.remoteOnly ?? false,
        salaryMin: initial?.salaryMin ?? 0,
    });

    const persistAndComplete = async (withResume: boolean) => {
        const trimmed: SearchPrefsValues = {
            query: values.query.trim(),
            location: values.location.trim(),
            remoteOnly: values.remoteOnly,
            salaryMin: values.salaryMin > 0 ? values.salaryMin : 0,
        };
        setSaving(true);
        try {
            await saveAgentPreferencesAction({
                search: {
                    query: trimmed.query,
                    location: trimmed.location || undefined,
                    remoteOnly: trimmed.remoteOnly || undefined,
                    salaryMin: trimmed.salaryMin || undefined,
                },
            });
            onComplete(trimmed);
            if (withResume) onAddResume?.();
            onOpenChange?.(false);
        } finally {
            setSaving(false);
        }
    };

    const handleContinue = () => {
        if (step === 3) {
            setStep(4);
            return;
        }
        setStep((s) => s + 1);
    };

    const form = (
        <SearchPrefsForm
            step={step}
            setStep={setStep}
            values={values}
            setValues={setValues}
            saving={saving}
            onContinue={handleContinue}
            onFinish={() => void persistAndComplete(false)}
            onAddResume={() => void persistAndComplete(true)}
        />
    );

    if (variant === "dialog") {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="rounded-none sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="text-title">Set up your job search</DialogTitle>
                        <DialogDescription className="text-[13.5px] leading-relaxed">
                            Tell us what you&apos;re looking for — we&apos;ll save it to your account.
                        </DialogDescription>
                    </DialogHeader>
                    {form}
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <div
            data-testid="search-prefs-setup-inline"
            className="mb-6 border border-border bg-card/50 p-4 sm:p-5"
        >
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Set up your job search</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
                Tell us what you&apos;re looking for — we&apos;ll save it to your account.
            </p>
            <div className="mt-4">{form}</div>
        </div>
    );
}

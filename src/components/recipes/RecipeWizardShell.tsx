"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONFIRM_CLOSE } from "@/lib/copy";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, ArrowLeft, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";

export interface WizardStep {
    id: string;
    label: string;
    optional?: boolean;
}

interface RecipeWizardShellProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    steps: WizardStep[];
    currentStep: number;
    onStepChange: (step: number) => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    showDefaultFooter?: boolean;
    canAdvance?: boolean;
    onComplete?: () => void;
    nextLabel?: string;
    backLabel?: string;
}

export function RecipeWizardShell({
    isOpen,
    onClose,
    title,
    description,
    steps,
    currentStep,
    onStepChange,
    children,
    footer,
    showDefaultFooter = true,
    canAdvance = true,
    onComplete,
    nextLabel,
    backLabel,
}: RecipeWizardShellProps) {
    const [confirmClose, setConfirmClose] = useState(false);
    const progress = ((currentStep + 1) / steps.length) * 100;
    const isLastStep = currentStep === steps.length - 1;
    const currentStepDef = steps[currentStep];

    const handleOpenChange = (open: boolean) => {
        if (!open && currentStep > 0) {
            setConfirmClose(true);
        } else if (!open) {
            onClose();
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={handleOpenChange}>
                <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden p-0">
                    {/* Progress bar at top */}
                    <ProgressBar progress={progress} className="rounded-t-lg" />

                    <div className="px-6 pt-4">
                        <DialogHeader className="pr-8">
                            <div className="flex items-center justify-between mb-1">
                                <DialogTitle>{title}</DialogTitle>
                                {/* Step indicator */}
                                <div className="flex items-center gap-2 text-xs">
                                    {steps.map((s, i) => (
                                        <div
                                            key={s.id}
                                            className={cn(
                                                "flex items-center gap-1",
                                                i <= currentStep
                                                    ? "text-primary font-medium"
                                                    : "text-muted-foreground"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "w-5 h-5 rounded-full flex items-center justify-center border text-[10px]",
                                                    i < currentStep
                                                        ? "bg-primary border-primary text-primary-foreground"
                                                        : i === currentStep
                                                          ? "border-primary text-primary"
                                                          : "border-muted-foreground/30"
                                                )}
                                            >
                                                {i < currentStep ? (
                                                    <Check size={10} weight="bold" />
                                                ) : (
                                                    i + 1
                                                )}
                                            </div>
                                            <span className="hidden sm:inline">{s.label}</span>
                                            {i < steps.length - 1 && (
                                                <div className="w-4 h-px bg-muted-foreground/20 mx-1" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {description && (
                                <DialogDescription>
                                    Step {currentStep + 1} of {steps.length} — {currentStepDef.label}
                                    {currentStepDef.optional && (
                                        <span className="text-muted-foreground/60"> (optional)</span>
                                    )}
                                </DialogDescription>
                            )}
                        </DialogHeader>
                    </div>

                    {/* Content area */}
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <div className="animate-in fade-in">{children}</div>
                    </div>

                    {/* Footer */}
                    {footer ? (
                        <div className="border-t px-6 py-4">{footer}</div>
                    ) : showDefaultFooter ? (
                        <DialogFooter className="border-t px-6 py-4">
                            <div className="flex justify-between w-full">
                                {currentStep > 0 ? (
                                    <Button
                                        variant="ghost"
                                        onClick={() => onStepChange(currentStep - 1)}
                                    >
                                        <ArrowLeft size={16} className="mr-2" />
                                        {backLabel || "Back"}
                                    </Button>
                                ) : (
                                    <Button variant="ghost" onClick={onClose}>
                                        Cancel
                                    </Button>
                                )}
                                <div className="flex gap-2">
                                    {currentStepDef.optional && !isLastStep && (
                                        <Button
                                            variant="outline"
                                            onClick={() => onStepChange(currentStep + 1)}
                                        >
                                            Skip
                                        </Button>
                                    )}
                                    {isLastStep ? (
                                        <Button onClick={onComplete} disabled={!canAdvance}>
                                            {nextLabel || "Finish"}
                                        </Button>
                                    ) : (
                                        <Button
                                            onClick={() => onStepChange(currentStep + 1)}
                                            disabled={!canAdvance}
                                        >
                                            {nextLabel || "Next"}
                                            <ArrowRight size={16} className="ml-2" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </DialogFooter>
                    ) : null}
                </DialogContent>
            </Dialog>

            {/* Confirm close dialog */}
            <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{CONFIRM_CLOSE.title}</DialogTitle>
                        <DialogDescription>
                            {CONFIRM_CLOSE.description}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmClose(false)}>
                            Continue Setup
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                // Close confirm dialog first, then close main dialog
                                // after a tick so Radix cleans up the overlay properly.
                                setConfirmClose(false);
                                requestAnimationFrame(() => onClose());
                            }}
                        >
                            Leave
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

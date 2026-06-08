"use client";

import { LoginForm } from "@/components/auth/login-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AuthPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    showTrigger?: boolean;
    /**
     * Fired on a *successful* sign-in, BEFORE the popover closes — giving the
     * parent a deterministic success signal it cannot otherwise distinguish
     * from a dismiss (a dismiss and a success both just call `onOpenChange(false)`).
     * Optional and backward-compatible: callers that don't pass it (e.g.
     * WelcomeStep) are unaffected. /jobs uses it to decide whether a queued
     * post-auth action may replay (success) or must be cleared (dismiss).
     */
    onAuthed?: () => void;
}

export function AuthPopover({ open, onOpenChange, showTrigger = true, onAuthed }: AuthPopoverProps) {
    const handleSuccess = () => {
        onAuthed?.();
        onOpenChange(false);
    };

    // When no trigger, use a Dialog instead (e.g. programmatic open from buttons)
    if (!showTrigger) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[380px] pt-12">
                    <DialogTitle className="sr-only">Authentication</DialogTitle>
                    <LoginForm onSuccess={handleSuccess} />
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9">
                    Log In
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[380px] p-0">
                <div className="p-5">
                    <LoginForm onSuccess={handleSuccess} />
                </div>
            </PopoverContent>
        </Popover>
    );
}

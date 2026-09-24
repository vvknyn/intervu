"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface PacksHomeIntroModalProps {
    open: boolean;
    onGotIt: () => void;
    onAddOrReplaceResume: () => void;
}

/**
 * Once-per-user intro for packs-as-home. Exact GTM paste-ready copy
 * GTM paste-ready strings only — no ranking metrics or geo claims.
 */
export function PacksHomeIntroModal({
    open,
    onGotIt,
    onAddOrReplaceResume,
}: PacksHomeIntroModalProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onGotIt();
            }}
        >
            <DialogContent
                className="max-w-md gap-5 rounded-panel border border-border bg-card p-6"
                data-testid="packs-home-intro-modal"
                showCloseButton={true}
            >
                <DialogHeader className="gap-3 text-left">
                    <DialogTitle className="text-lg font-semibold leading-snug text-foreground">
                        Jobs with a résumé, not a search box
                    </DialogTitle>
                    <DialogDescription asChild>
                        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                            <p>
                                Velai isn&apos;t a job board you filter all night. Upload one résumé and we
                                put a short stack of live roles in front of you, pulled from employer career
                                pages. Swipe through the matches. Skip what isn&apos;t you. Apply when it is.
                            </p>
                            <p>Search is still there if you need it. Packs are the product now.</p>
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                        type="button"
                        variant="ghost"
                        className="order-2 min-h-11 font-semibold sm:order-1"
                        data-testid="packs-home-intro-resume"
                        onClick={onAddOrReplaceResume}
                    >
                        Add or replace résumé
                    </Button>
                    <Button
                        type="button"
                        className="order-1 min-h-11 font-semibold sm:order-2"
                        data-testid="packs-home-intro-got-it"
                        onClick={onGotIt}
                    >
                        Got it — show my packs
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

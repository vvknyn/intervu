"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Article } from "@phosphor-icons/react";
import { SourcesManager } from "@/components/settings/SourcesManager";
import { SourceItem } from "@/types";

interface AddSourcesRecipeDialogProps {
    isOpen: boolean;
    onClose: () => void;
    sources: SourceItem[];
    onSourcesChange: (sources: SourceItem[]) => void;
}

export function AddSourcesRecipeDialog({
    isOpen,
    onClose,
    sources,
    onSourcesChange,
}: AddSourcesRecipeDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Article size={20} weight="duotone" className="text-brand" />
                        Add Sources & Knowledge
                    </DialogTitle>
                    <DialogDescription>
                        Add articles, company research, Glassdoor reviews, or notes. These feed into your interview prep to give more relevant, personalized results.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
                    <SourcesManager
                        sources={sources}
                        onChange={onSourcesChange}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

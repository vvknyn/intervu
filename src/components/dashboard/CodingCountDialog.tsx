"use client";

import { useState } from "react";
import { Code } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CodingCountDialogProps {
    open: boolean;
    onConfirm: (count: number) => void;
    onSkip: () => void;
}

export function CodingCountDialog({ open, onConfirm, onSkip }: CodingCountDialogProps) {
    const [selected, setSelected] = useState(3);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onSkip(); }}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                            <Code size={20} weight="fill" />
                        </div>
                        <DialogTitle>Technical Role Detected</DialogTitle>
                    </div>
                    <DialogDescription>
                        How many coding challenges would you like to practice? Each challenge is modeled after real interview problems from platforms like LeetCode and HackerRank.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-center gap-2 py-4">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            onClick={() => setSelected(n)}
                            className={cn(
                                "w-12 h-12 rounded-xl text-lg font-bold transition-all",
                                selected === n
                                    ? "bg-brand text-brand-foreground shadow-md scale-110"
                                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            {n}
                        </button>
                    ))}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
                        Skip Coding
                    </Button>
                    <Button onClick={() => onConfirm(selected)}>
                        Generate {selected} Challenge{selected !== 1 ? 's' : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

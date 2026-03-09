"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { MagnifyingGlass } from "@phosphor-icons/react";

interface PrepareInterviewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (query: string) => void;
}

export function PrepareInterviewDialog({ isOpen, onClose, onSubmit }: PrepareInterviewDialogProps) {
    const [company, setCompany] = useState("");
    const [role, setRole] = useState("");
    const [round, setRound] = useState("");

    const handleSubmit = () => {
        const query = [company, role, round].filter(Boolean).join(", ");
        if (!query.trim()) return;
        onSubmit(query);
        setCompany("");
        setRole("");
        setRound("");
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setCompany("");
            setRole("");
            setRound("");
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MagnifyingGlass size={20} weight="duotone" className="text-purple-600" />
                        Prepare for an Interview
                    </DialogTitle>
                    <DialogDescription>
                        Enter the company, role, and interview round to generate personalized prep.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="prep-company" className="text-xs">Company</Label>
                        <Input
                            id="prep-company"
                            placeholder="e.g. Google"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="prep-role" className="text-xs">Role</Label>
                        <Input
                            id="prep-role"
                            placeholder="e.g. Software Engineer"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="prep-round" className="text-xs">Interview Round</Label>
                        <Input
                            id="prep-round"
                            placeholder="e.g. Technical Screen, Onsite, Behavioral"
                            value={round}
                            onChange={(e) => setRound(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!company.trim()}>
                        Analyze
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

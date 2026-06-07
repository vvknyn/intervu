"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { addInterviewQuestion } from "@/actions/interview-questions";
import { CircleNotch as Loader2 } from "@phosphor-icons/react";

interface AddQuestionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    applicationId?: string;
    onSuccess?: () => void;
}

export function AddQuestionModal({
    open,
    onOpenChange,
    applicationId,
    onSuccess,
}: AddQuestionModalProps) {
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!question.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const result = await addInterviewQuestion({
                question: question.trim(),
                applicationId,
            });

            if (result.error) {
                setError(result.error);
            } else {
                setQuestion("");
                onOpenChange(false);
                if (onSuccess) onSuccess();
            }
        } catch (e: any) {
            setError(e.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Add Interview Question</DialogTitle>
                    <DialogDescription>
                        Record a question you were asked. AI will generate a suggested answer and tags automatically.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="question">Question</Label>
                        <Textarea
                            id="question"
                            placeholder="e.g. Tell me about a time you improved a complex system process..."
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            className="h-32 resize-none"
                        />
                    </div>
                </div>

                {error && (
                    <div className="text-sm text-red-500 mb-4 bg-red-50 p-2 rounded">
                        {error}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || !question.trim()}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Generate Answer & Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

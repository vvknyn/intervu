"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/actions/feedback";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle, WarningCircle, Spinner } from "@phosphor-icons/react";

interface FeedbackModalProps {
    children: React.ReactNode;
}

export function FeedbackModal({ children }: FeedbackModalProps) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<"bug" | "feedback" | "other">("feedback");
    const [message, setMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const pathname = usePathname();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;

        setIsSubmitting(true);
        setStatus("idle");

        try {
            const result = await submitFeedback({
                type,
                message,
                path: pathname || window.location.pathname,
            });

            if (result.success) {
                setStatus("success");
                setMessage("");
                // Close after delay
                setTimeout(() => {
                    setOpen(false);
                    setStatus("idle");
                }, 2000);
            } else {
                setStatus("error");
            }
        } catch (error) {
            console.error(error);
            setStatus("error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            // Reset state after closing animation
            setTimeout(() => {
                setStatus("idle");
                setMessage("");
                setType("feedback");
            }, 300);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Send Feedback</DialogTitle>
                    <DialogDescription>
                        Report a bug or share your thoughts. We appreciate your input!
                    </DialogDescription>
                </DialogHeader>

                {status === "success" ? (
                    <div className="flex flex-col items-center justify-center py-6 space-y-2 text-center">
                        <CheckCircle size={48} className="text-live" weight="fill" />
                        <h3 className="text-lg">Thank you!</h3>
                        <p className="text-sm text-muted-foreground">
                            Your feedback has been submitted successfully.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="type">Type</Label>
                            <Select
                                value={type}
                                onValueChange={(val) => setType(val as any)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="bug">Report a Bug</SelectItem>
                                    <SelectItem value="feedback">Product Feedback</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="message">Message</Label>
                            <Textarea
                                id="message"
                                placeholder={
                                    type === "bug"
                                        ? "Describe what happened, steps to reproduce, etc."
                                        : "Tell us what you like or what could be improved..."
                                }
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                className="min-h-[120px] resize-none"
                                required
                            />
                        </div>

                        {status === "error" && (
                            <div className="flex items-center gap-2 text-sm text-destructive bg-muted p-2 rounded-md">
                                <WarningCircle size={16} weight="fill" />
                                <span>Failed to submit feedback. Please try again.</span>
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setOpen(false)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting || !message.trim()}>
                                {isSubmitting && (
                                    <Spinner className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Submit
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

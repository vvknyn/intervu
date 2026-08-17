"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitContactMessage } from "@/actions/contact";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function ContactForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const pathname = usePathname();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        setIsSubmitting(true);
        setStatus("idle");
        setError(null);

        try {
            const result = await submitContactMessage({
                name: name || undefined,
                email,
                message,
                honeypot,
                path: pathname || window.location.pathname,
            });

            if (result.success) {
                setStatus("success");
            } else {
                setStatus("error");
                setError(result.error ?? "Failed to send your message. Please try again.");
            }
        } catch (err) {
            console.error(err);
            setStatus("error");
            setError("Failed to send your message. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === "success") {
        return (
            <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6 text-emerald-700 dark:text-emerald-300">
                <p className="font-semibold text-base">Message Sent Successfully</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    Got it — we read everything and reply directly from <span className="font-mono text-foreground font-medium">hello@thesubspace.io</span>.
                </p>
            </div>
        );
    }

    return (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                    <Label htmlFor="name" className="font-medium text-foreground">Name</Label>
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="h-11 rounded-xl border-border bg-background px-3.5 focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email" className="font-medium text-foreground">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                        className="h-11 rounded-xl border-border bg-background px-3.5 focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="message" className="font-medium text-foreground">Message</Label>
                    <Textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Questions, feedback, corrections, or partnerships..."
                        className="min-h-[140px] rounded-xl border-border bg-background p-3.5 focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                        required
                        minLength={10}
                    />
                </div>

                {/* Honeypot — visually hidden but present in the DOM/tab order for
                    bots that autofill every field. Real users never see or fill it. */}
                <div className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden" aria-hidden="true">
                    <input
                        type="text"
                        name="website"
                        tabIndex={-1}
                        autoComplete="off"
                        value={honeypot}
                        onChange={(e) => setHoneypot(e.target.value)}
                    />
                </div>

                {status === "error" && error && (
                    <p className="text-sm text-destructive">{error}</p>
                )}

                <Button type="submit" variant="brand" size="lg" disabled={isSubmitting} className="h-11 px-7 font-semibold">
                    {isSubmitting ? "Sending…" : "Send message"}
                </Button>
            </form>
        </div>
    );
}

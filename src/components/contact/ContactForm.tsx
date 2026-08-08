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
            <p className="mt-8 text-sm text-foreground">
                Got it — we read everything and reply from hello@intervu.cc.
            </p>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-none focus:border-foreground focus-visible:border-foreground focus-visible:ring-foreground/20"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="rounded-none focus:border-foreground focus-visible:border-foreground focus-visible:ring-foreground/20"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[120px] rounded-none focus-visible:border-foreground focus-visible:ring-foreground/20"
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

            <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send message"}
            </Button>
        </form>
    );
}

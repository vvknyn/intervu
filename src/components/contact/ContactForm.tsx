"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

const DEFAULT_ERROR = "Failed to send your message. Please try again.";

/** Every error path — server-reported or client-caught — must leave a
 *  person somewhere to go, not just a dead end in the form. */
function withEscapeHatch(message?: string | null): string {
    return `${message ?? DEFAULT_ERROR} — or email us directly at ${PUBLIC_SUPPORT_EMAIL}`;
}

export function ContactForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    // Bumped after a refused submit: the token it sent is spent (single-use).
    const [turnstileResetKey, setTurnstileResetKey] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isBugReport = searchParams.get("kind") === "bug";
    // Client-side navigations never update `document.referrer` (Next.js
    // route transitions don't reload the document), so a visitor who
    // arrived via a <Link> and reported a bug several pages later would
    // have `referrer` still pointing at whatever loaded the tab (often an
    // external referrer like a search engine). The footer's "Report a bug"
    // link carries the page it was clicked from as `?from=`, which is the
    // page that's actually relevant — trust it over `referrer` when
    // present, and only when it's a same-site path (never an absolute URL).
    const fromParam = searchParams.get("from");
    const resolvedFromPage = fromParam && fromParam.startsWith("/") ? fromParam : undefined;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        setIsSubmitting(true);
        setStatus("idle");
        setError(null);

        try {
            const response = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name || undefined,
                    email,
                    message,
                    honeypot,
                    turnstileToken: turnstileToken ?? undefined,
                    path: pathname || window.location.pathname,
                    kind: isBugReport ? "bug" : "message",
                    context: isBugReport
                        ? {
                              page: resolvedFromPage || document.referrer || undefined,
                              userAgent: navigator.userAgent,
                              viewport: `${window.innerWidth}x${window.innerHeight}`,
                          }
                        : undefined,
                }),
                signal: AbortSignal.timeout(20000),
            });
            const result = await response.json();

            if (result.success) {
                setStatus("success");
            } else {
                setStatus("error");
                setError(withEscapeHatch(result.error));
                setTurnstileResetKey((key) => key + 1);
            }
        } catch (err) {
            console.error(err);
            setStatus("error");
            setError(withEscapeHatch());
            setTurnstileResetKey((key) => key + 1);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === "success") {
        return (
            <Alert variant="live" className="mt-8">
                <AlertTitle>Message sent successfully</AlertTitle>
                <AlertDescription>
                    Got it — we read everything and reply directly from {PUBLIC_SUPPORT_EMAIL}.
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="mt-8 rounded-none border border-border bg-card p-6 sm:p-8">
            {isBugReport && (
                <div className="mb-5">
                    <h2 className="text-base font-semibold text-foreground">Report a bug</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Tell us what went wrong and what you expected to happen instead.
                    </p>
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
                <Field label="Name" htmlFor="name">
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                    />
                </Field>

                <Field label="Email" htmlFor="email">
                    <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                    />
                </Field>

                <Field label="Message" htmlFor="message">
                    <Textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={
                            isBugReport
                                ? "What went wrong, and what did you expect to happen instead?"
                                : "Questions, feedback, corrections, or partnerships..."
                        }
                        className="min-h-[140px]"
                        required
                        minLength={10}
                    />
                </Field>

                {/* Honeypot — visually hidden but present in the DOM/tab order for
                    bots that autofill every field. Real users never see or fill it. */}
                {/* design-lint-allow: 9999px is a deliberately-huge off-screen
                    offset for a honeypot, not a spacing literal on a rung. */}
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

                <TurnstileWidget surface="contact" onVerify={setTurnstileToken} resetKey={turnstileResetKey} />

                {status === "error" && error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {isBugReport && (
                    <p className="text-xs text-muted-foreground">
                        Your browser and the page you came from are included to help us debug.
                    </p>
                )}

                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Sending…" : isBugReport ? "Send report" : "Send message"}
                </Button>
            </form>
        </div>
    );
}

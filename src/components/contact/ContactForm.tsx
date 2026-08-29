"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";

const DEFAULT_ERROR = "Failed to send your message. Please try again.";

/** Every error path — server-reported or client-caught — must leave a
 *  person somewhere to go, not just a dead end in the form. */
function withEscapeHatch(message?: string | null): string {
    return `${message ?? DEFAULT_ERROR} — or email us directly at hello@thesubspace.io`;
}

export function ContactForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
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
            }
        } catch (err) {
            console.error(err);
            setStatus("error");
            setError(withEscapeHatch());
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === "success") {
        return (
            <div className="mt-8 rounded-none border border-brand/40 bg-brand/10 p-6 text-foreground backdrop-blur-xl">
                <p className="text-sm font-bold uppercase tracking-wider text-brand">Message Sent Successfully</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    Got it — we read everything and reply directly from <span className="text-foreground font-medium">hello@thesubspace.io</span>.
                </p>
            </div>
        );
    }

    return (
        <div className="mt-8 rounded-none border border-border/80 bg-card/75 p-6 sm:p-8 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
            {isBugReport && (
                <div className="mb-5">
                    <h2 className="text-base font-bold text-foreground">Report a bug</h2>
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
                        className="h-11 rounded-none border-border bg-background px-3.5 focus:border-foreground focus-visible:ring-1 focus-visible:ring-foreground"
                    />
                </Field>

                <Field label="Email" htmlFor="email">
                    <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                        className="h-11 rounded-none border-border bg-background px-3.5 focus:border-foreground focus-visible:ring-1 focus-visible:ring-foreground"
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
                        className="min-h-[140px] rounded-none border-border bg-background p-3.5 focus:border-foreground focus-visible:ring-1 focus-visible:ring-foreground"
                        required
                        minLength={10}
                    />
                </Field>

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

                <TurnstileWidget onVerify={setTurnstileToken} />

                {status === "error" && error && (
                    <p className="text-xs text-destructive">{error}</p>
                )}

                {isBugReport && (
                    <p className="text-[11px] text-muted-foreground">
                        Your browser and the page you came from are included to help us debug.
                    </p>
                )}

                <Button type="submit" size="lg" disabled={isSubmitting} className="h-11 rounded-none bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider px-7 hover:bg-primary/90 transition-colors">
                    {isSubmitting ? "Sending…" : isBugReport ? "Send report →" : "Send message →"}
                </Button>
            </form>
        </div>
    );
}

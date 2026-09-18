"use client";

import { useState, useEffect } from "react";
import { X, ShieldCheck } from "@phosphor-icons/react";

const DISMISS_KEY = "privacy-notice-dismissed";

export function PrivacyNotice() {
    const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

    useEffect(() => {
        const wasDismissed = localStorage.getItem(DISMISS_KEY);
        if (!wasDismissed) {
            setDismissed(false);
        }
    }, []);

    const handleDismiss = () => {
        localStorage.setItem(DISMISS_KEY, "true");
        setDismissed(true);
    };

    if (dismissed) return null;

    return (
        <div className="relative bg-card rounded-panel p-4 mb-6 animate-in fade-in duration-300">
            <button
                onClick={handleDismiss}
                className="absolute top-3 right-3 p-1 rounded-ctl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Dismiss"
            >
                <X />
            </button>

            <div className="flex gap-3 pr-8">
                <div className="flex-shrink-0 mt-0.5">
                    <ShieldCheck size={20} className="text-brand" />
                </div>
                <div className="space-y-1.5">
                    <p className="text-xs font-semibold">Your data stays yours</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        AI features — resume parsing and resume tailoring — send the relevant text (your resume, a
                        job description) to an AI provider (OpenRouter or Groq) to
                        generate a response. That text is sent transiently and isn&apos;t stored by us beyond
                        producing that response, and we don&apos;t use it to train anything. No data is shared with
                        third parties beyond the provider handling that request. You can export or delete all your
                        data at any time from Settings.
                    </p>
                </div>
            </div>
        </div>
    );
}

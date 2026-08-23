"use client";

import type { User } from "@/lib/firebase/client-auth";
import { ByokKeyForm } from "@/components/settings/ByokKeyForm";

interface ApiKeySectionProps {
    user: User | null;
    onLoginClick: () => void;
}

export function ApiKeySection({ user, onLoginClick }: ApiKeySectionProps) {
    if (!user) {
        return (
            <p className="text-sm text-muted-foreground">
                <button type="button" onClick={onLoginClick} className="underline text-brand hover:text-brand/80">
                    Log in
                </button>{" "}
                to add your OpenRouter or Groq API key.
            </p>
        );
    }

    return (
        <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
                Free tier uses your own API key. Pick a provider, get a key, test it, save. Intervu never sees the
                plaintext after save (encrypted).
            </p>
            <ByokKeyForm />
        </div>
    );
}

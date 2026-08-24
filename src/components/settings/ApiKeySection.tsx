"use client";

import type { User } from "@/lib/firebase/client-auth";
import { ByokKeyForm } from "@/components/settings/ByokKeyForm";
import { BETA_UNLIMITED_CREDITS, CREDIT_UNIT } from "@/lib/llm/credit-copy";

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
            {/* Which sentence is true depends on the same constant the credit
                gate reads, so this can't drift from what actually happens. It
                already had: the old copy said "Free tier uses your own API
                key", which stopped being true the day beta-unlimited went on
                and left this screen telling people a key was required. */}
            <p className="text-[13px] leading-relaxed text-muted-foreground">
                {BETA_UNLIMITED_CREDITS
                    ? "AI actions are free and unlimited while we're in beta, so you don't need a key for anything. Add one only if you'd rather your AI requests ran on your own provider account."
                    : `Add your own provider key to run AI actions on your own account, instead of drawing on your free ${CREDIT_UNIT.many} each month.`}
            </p>
            <ByokKeyForm />
        </div>
    );
}

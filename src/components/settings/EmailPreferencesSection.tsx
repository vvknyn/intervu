"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import type { User } from "@/lib/firebase/client-auth";
import { getEmailPreferencesAction, setDigestPreferenceAction, type EmailPreferences } from "@/actions/email-preferences";
import { getAccountEmailStateAction } from "@/actions/account-email";
import { AccountEmailPrompt } from "@/components/account/AccountEmailPrompt";
import type { EmailNudgeState } from "@/lib/auth/account-email";
import { Switch } from "@/components/settings/Switch";

export function EmailPreferencesSection({ user }: { user: User | null }) {
    const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
    const [saving, setSaving] = useState(false);
    const [emailState, setEmailState] = useState<EmailNudgeState | null>(null);
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        void getEmailPreferencesAction().then((res) => {
            if (res.data) setPrefs(res.data);
        });
        void getAccountEmailStateAction().then((res) => {
            if (res.data) {
                setEmailState(res.data.state);
                setPendingEmail(res.data.pendingEmail);
            }
        });
    }, [user]);

    if (!user) return null;

    const toggleDigest = async () => {
        if (!prefs || saving) return;
        const next = !prefs.digestEnabled;
        setSaving(true);
        setPrefs({ ...prefs, digestEnabled: next });
        const result = await setDigestPreferenceAction(next);
        setSaving(false);
        if ("error" in result) {
            setPrefs((p) => (p ? { ...p, digestEnabled: !next } : p));
            toast.error(result.error);
        }
    };

    return (
        <div>
            <h2 className="mb-1 text-base font-semibold leading-snug">Email</h2>
            <p className="mb-4 text-sm text-muted-foreground">Which emails velai sends you.</p>

            {prefs ? (
                prefs.needsEmail ? (
                    // The digest switch is deliberately NOT rendered here. A
                    // control that decides where nothing can be delivered is
                    // the bug this section had: it showed the digest ON while
                    // every send was being dropped as `no-mailbox`.
                    <AccountEmailPrompt
                        state={emailState ?? "needs-email"}
                        pendingEmail={pendingEmail}
                        onPending={(email) => {
                            setPendingEmail(email);
                            setEmailState("pending-confirmation");
                        }}
                        className="rounded-panel border border-border p-4"
                    />
                ) : (
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm">Weekly digest</p>
                            <p className="text-xs text-muted-foreground">
                                New roles from your followed companies and saved searches.
                                {prefs.blockedGlobally && " Blocked — you've unsubscribed from all velai emails."}
                            </p>
                        </div>
                        <Switch checked={prefs.digestEnabled} onChange={() => void toggleDigest()} disabled={saving} aria-label="Weekly digest" />
                    </div>
                )
            ) : (
                <p className="text-xs text-muted-foreground">Loading…</p>
            )}
        </div>
    );
}

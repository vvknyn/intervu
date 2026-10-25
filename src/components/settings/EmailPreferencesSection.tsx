"use client";

import { settleAction } from "@/lib/load-result";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import type { User } from "@/lib/firebase/client-auth";
import { getEmailPreferencesAction, setDigestPreferenceAction, type EmailPreferences } from "@/actions/email-preferences";
import { getAccountEmailStateAction } from "@/actions/account-email";
import { AccountEmailPrompt } from "@/components/account/AccountEmailPrompt";
import type { EmailNudgeState } from "@/lib/auth/account-email";
import { Switch } from "@/components/ui/switch";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { Button } from "@/components/ui/button";
import { SettingsInlineError } from "@/components/settings/SettingsInlineError";
import { DailyPicksSettingsRow, useDailyPicks } from "@/components/daily-picks/DailyPicksSwitch";

export function EmailPreferencesSection({ user }: { user: User | null }) {
    const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
    const [saving, setSaving] = useState(false);
    const [emailState, setEmailState] = useState<EmailNudgeState | null>(null);
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);

    // A failed read used to leave "Loading email preferences" spinning for
    // good; it now ends in an error with a retry, like the other settings
    // cards.
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    // Read once the account has an address mail reaches: without one there is no switch to show.
    const dailyPicks = useDailyPicks(Boolean(user) && prefs?.needsEmail === false, user?.uid ?? null, "settings");

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        void getEmailPreferencesAction()
            .then((res) => {
                if (cancelled) return;
                if (res.data) setPrefs(res.data);
                else setLoadFailed(true);
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true);
            });
        void getAccountEmailStateAction()
            .then((res) => {
                if (cancelled || !res.data) return;
                setEmailState(res.data.state);
                setPendingEmail(res.data.pendingEmail);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [user, attempt]);

    const retryLoad = () => {
        setLoadFailed(false);
        setAttempt((n) => n + 1);
    };

    if (!user) return null;

    const toggleDigest = async () => {
        if (!prefs || saving) return;
        const next = !prefs.digestEnabled;
        setSaving(true);
        setPrefs({ ...prefs, digestEnabled: next });
        const result = await settleAction(setDigestPreferenceAction(next));
        setSaving(false);
        if ("error" in result) {
            setPrefs((p) => (p ? { ...p, digestEnabled: !next } : p));
            toast.error(result.error);
        }
    };

    return (
        <div>
            <h2 className="mb-1 text-base font-semibold leading-snug">Email</h2>
            <p className="mb-4 text-sm text-muted-foreground">Which emails Velai sends you.</p>

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
                        className="rounded-panel border border-border bg-surface-2 p-4 shadow-[var(--shadow-bevel-inset)]"
                    />
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm">Weekly digest</p>
                                <p className="text-xs text-muted-foreground">
                                    New roles from your followed companies and saved searches.
                                    {prefs.blockedGlobally && " Blocked — you've unsubscribed from all Velai emails."}
                                </p>
                            </div>
                            <Switch checked={prefs.digestEnabled} onChange={() => void toggleDigest()} disabled={saving} aria-label="Weekly digest" />
                        </div>
                        <DailyPicksSettingsRow control={dailyPicks} />
                    </div>
                )
            ) : loadFailed ? (
                <div className="space-y-3">
                    <SettingsInlineError>Couldn&apos;t load your email preferences.</SettingsInlineError>
                    <Button variant="outline" size="sm" onClick={retryLoad} data-testid="email-preferences-retry">
                        Try again
                    </Button>
                </div>
            ) : (
                <WaitState
                    label="Loading email preferences"
                    skeleton={
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1 space-y-2">
                                <WaitBar className="h-4 w-28 rounded-ctl" />
                                <WaitBar className="h-3 w-full max-w-sm rounded-ctl" />
                            </div>
                            <WaitBar className="h-6 w-11 shrink-0 rounded-pill" />
                        </div>
                    }
                />
            )}
        </div>
    );
}

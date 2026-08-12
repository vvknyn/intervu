"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import type { User } from "@/lib/firebase/client-auth";
import { getEmailPreferencesAction, setDigestPreferenceAction, type EmailPreferences } from "@/actions/email-preferences";

/** Same hand-rolled switch idiom `AgentPreferencesSection.tsx` already
 *  uses ("Remote only") — one toggle pattern, not a second one invented
 *  here. */
function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onChange}
            disabled={disabled}
            role="switch"
            aria-checked={checked}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-brand" : "bg-muted"}`}
        >
            <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
            />
        </button>
    );
}

export function EmailPreferencesSection({ user }: { user: User | null }) {
    const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!user) return;
        void getEmailPreferencesAction().then((res) => {
            if (res.data) setPrefs(res.data);
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
            <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.02em]">Email</h2>
            <p className="mb-4 text-[13px] text-muted-foreground">Which emails intervu sends you.</p>

            {prefs ? (
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium">Weekly digest</p>
                        <p className="text-[12px] text-muted-foreground">
                            New roles from your followed companies and saved searches.
                            {prefs.blockedGlobally && " Blocked — you've unsubscribed from all intervu emails."}
                        </p>
                    </div>
                    <Switch checked={prefs.digestEnabled} onChange={() => void toggleDigest()} disabled={saving} />
                </div>
            ) : (
                <p className="text-[13px] text-muted-foreground">Loading…</p>
            )}
        </div>
    );
}

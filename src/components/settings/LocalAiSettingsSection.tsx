"use client";

import { useEffect, useState } from "react";
import { applyLocalAiSearchParam, readLocalAiEnabled, writeLocalAiEnabled } from "@/lib/local-ai/flag";
import { revokeLocalAiConsent } from "@/lib/local-ai/consent";
import { useSearchParams } from "next/navigation";

/** Same hand-rolled switch as EmailPreferencesSection / AgentPreferencesSection. */
function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
        <button
            type="button"
            onClick={onChange}
            role="switch"
            aria-checked={checked}
            className={`relative inline-flex h-6 w-11 items-center rounded-none transition-colors ${checked ? "bg-brand" : "bg-muted"}`}
        >
            <span
                className={`inline-block h-4 w-4 rounded-none bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
            />
        </button>
    );
}

/**
 * R&D toggle: on-device résumé parse instead of cloud LLM.
 * Persisted in localStorage; `?localAi=1` on /settings also enables it.
 */
export function LocalAiSettingsSection() {
    const searchParams = useSearchParams();
    const [enabled, setEnabled] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const param = searchParams.get("localAi");
        const active = applyLocalAiSearchParam(param);
        setEnabled(active);
        setMounted(true);
    }, [searchParams]);

    const toggle = () => {
        const next = !enabled;
        writeLocalAiEnabled(next);
        if (!next) revokeLocalAiConsent();
        setEnabled(next);
    };

    if (!mounted) {
        return <p className="text-xs text-muted-foreground">Loading…</p>;
    }

    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className="text-sm">On-device resume parse (R&amp;D)</p>
                <p className="text-xs text-muted-foreground">
                    Parse résumés in your browser instead of the cloud LLM. Add{" "}
                    <code className="text-[11px]">?localAi=1</code> to any URL to enable.
                    Default users still use cloud parse.
                </p>
            </div>
            <Switch checked={enabled} onChange={toggle} />
        </div>
    );
}

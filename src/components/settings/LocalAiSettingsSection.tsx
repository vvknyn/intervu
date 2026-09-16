"use client";

import { useEffect, useState } from "react";
import { applyLocalAiSearchParam, readLocalAiEnabled, writeLocalAiEnabled } from "@/lib/local-ai/flag";
import { revokeLocalAiConsent, grantLocalAiConsent, readLocalAiConsent } from "@/lib/local-ai/consent";
import { probeBestEngine, initLocalAiLadder, getEngineLabel, getActiveEngineId, getActiveEngineLabel } from "@/lib/local-ai/ladder";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Cpu, DownloadSimple, CheckCircle, ShieldCheck } from "@phosphor-icons/react";
import type { LocalAiEngineId } from "@/lib/local-ai/engines/types";

/**
 * Modern, sharp, accessible switch with 1px border and symmetric knob inset.
 * Bounded margins: exactly 3px track margin all around, no cut-out or clipping.
 */
export function Switch({
    checked,
    onChange,
    disabled,
    "aria-label": ariaLabel,
}: {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    return (
        <button
            type="button"
            onClick={onChange}
            disabled={disabled}
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-none border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-brand text-brand-foreground" : "bg-muted"}`}
        >
            <span
                className={`inline-block h-4 w-4 rounded-none border border-border bg-card transition-transform ${checked ? "translate-x-[23px]" : "translate-x-[3px]"}`}
            />
        </button>
    );
}

/**
 * On-Device AI inference settings:
 * Local WebGPU / WASM model download and execution for 100% private resume parsing & tailoring.
 */
export function LocalAiSettingsSection() {
    const searchParams = useSearchParams();
    const [enabled, setEnabled] = useState(false);
    const [consent, setConsent] = useState(false);
    const [bestEngine, setBestEngine] = useState<LocalAiEngineId | null>(null);
    const [activeEngine, setActiveEngine] = useState<string>("heuristic");
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const param = searchParams.get("localAi");
        const active = applyLocalAiSearchParam(param);
        setEnabled(active);
        setConsent(readLocalAiConsent());
        setMounted(true);

        void probeBestEngine().then((eng) => {
            setBestEngine(eng);
        });
        setActiveEngine(getActiveEngineLabel());
    }, [searchParams]);

    const toggle = () => {
        const next = !enabled;
        writeLocalAiEnabled(next);
        if (!next) {
            revokeLocalAiConsent();
            setConsent(false);
        }
        setEnabled(next);
    };

    const handleDownloadModel = async () => {
        setIsDownloading(true);
        setDownloadError(null);
        try {
            grantLocalAiConsent();
            setConsent(true);
            await initLocalAiLadder();
            setActiveEngine(getActiveEngineLabel());
        } catch (e: unknown) {
            setDownloadError(e instanceof Error ? e.message : "Failed to download model weights");
        } finally {
            setIsDownloading(false);
        }
    };

    if (!mounted) {
        return <p className="text-xs text-muted-foreground">Loading…</p>;
    }

    const hasDownloaded = consent && activeEngine !== "heuristic" && getActiveEngineId() !== "heuristic";

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <ShieldCheck size={16} className="text-brand shrink-0" />
                        <p className="text-sm font-semibold">On-device AI inference</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Parse résumés and tailor applications directly in your browser using local WebGPU and WASM models.
                        Zero cloud tracking — your résumé text never leaves your device.
                    </p>
                </div>
                <Switch checked={enabled} onChange={toggle} aria-label="Toggle on-device AI inference" />
            </div>

            {enabled ? (
                <div className="rounded-none border border-border bg-muted p-3.5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                            <Cpu size={16} className="text-brand shrink-0" />
                            <span className="font-semibold text-foreground">
                                {bestEngine ? `Available engine: ${getEngineLabel(bestEngine)}` : "Detecting local hardware acceleration…"}
                            </span>
                        </div>
                        {hasDownloaded ? (
                            <span className="inline-flex items-center gap-1 text-live font-semibold">
                                <CheckCircle size={16} weight="fill" />
                                Model active ({activeEngine})
                            </span>
                        ) : (
                            <span className="text-muted-foreground">
                                {consent ? "Model initialized" : "Model not downloaded"}
                            </span>
                        )}
                    </div>

                    {!hasDownloaded && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border">
                            <p className="text-xs text-muted-foreground">
                                Preload the local model into your browser cache for instant on-device parsing and tailoring.
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleDownloadModel()}
                                disabled={isDownloading}
                                className="h-8 shrink-0 rounded-none text-xs font-semibold"
                            >
                                <DownloadSimple size={16} className="mr-1.5" />
                                {isDownloading ? "Downloading model…" : "Download on-device model"}
                            </Button>
                        </div>
                    )}

                    {downloadError && (
                        <p className="text-xs text-danger-text">{downloadError}</p>
                    )}
                </div>
            ) : (
                <div className="rounded-none border border-border bg-muted p-3 text-xs text-muted-foreground">
                    On-device AI is currently disabled. Résumés and role matching will run with standard keyword and heuristic rules without loading AI weights into your browser.
                </div>
            )}
        </div>
    );
}

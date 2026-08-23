"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleNotch, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { validateProviderKey } from "@/actions/llm-settings";
import { fetchProfile, saveProviderApiKey, setPreferredProvider } from "@/actions/profile";
import { KEY_PLACEHOLDERS, type ByokProvider, type ProviderKeyPresence } from "@/lib/llm/byok";
import { PROVIDERS } from "@/lib/llm/models";
import { cn } from "@/lib/utils";
import { ByokOnboardingGuide } from "@/components/settings/ByokOnboardingGuide";

type VerifyState = "idle" | "checking" | "ok" | "fail";

export interface ByokKeyFormProps {
    className?: string;
    /** Called after a successful save or key removal. */
    onChanged?: () => void;
}

export function ByokKeyForm({ className, onChanged }: ByokKeyFormProps) {
    const [provider, setProvider] = useState<ByokProvider>("openrouter");
    const [keyInput, setKeyInput] = useState("");
    const [hasKey, setHasKey] = useState<ProviderKeyPresence>({ openrouter: false, groq: false });
    const [preferredProvider, setPreferredProviderState] = useState<ByokProvider | null>(null);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [verify, setVerify] = useState<VerifyState>("idle");
    const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

    const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
    const canSave = verify === "ok" && keyInput.trim().length > 0;

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            const { data, error } = await fetchProfile();
            if (!alive) return;
            if (error || !data) {
                setLoading(false);
                return;
            }
            setHasKey(data.provider_keys);
            const preferred = data.preferred_provider;
            if (preferred === "openrouter" || preferred === "groq") {
                setPreferredProviderState(preferred);
                setProvider(preferred);
            } else if (data.provider_keys.openrouter) {
                setProvider("openrouter");
            } else if (data.provider_keys.groq) {
                setProvider("groq");
            }
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        setKeyInput("");
        setVerify("idle");
        setVerifyMsg(null);
    }, [provider]);

    const handleTest = async () => {
        const trimmed = keyInput.trim();
        if (!trimmed) {
            toast.error("Paste your API key first.");
            return;
        }
        setTesting(true);
        setVerify("checking");
        setVerifyMsg(null);
        try {
            const res = await validateProviderKey(provider, trimmed);
            if (res.valid) {
                setVerify("ok");
                setVerifyMsg("Key works.");
                toast.success(`${providerName} key verified.`);
            } else {
                setVerify("fail");
                setVerifyMsg(res.error || "Invalid key.");
                toast.error(res.error || "Key verification failed.");
            }
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        const trimmed = keyInput.trim();
        if (!trimmed || verify !== "ok") return;
        setSaving(true);
        try {
            const saveRes = await saveProviderApiKey(provider, trimmed);
            if (saveRes.error) {
                toast.error(saveRes.error);
                setVerify("fail");
                setVerifyMsg(saveRes.error);
                return;
            }
            const prefRes = await setPreferredProvider(provider);
            if (prefRes.error) {
                toast.error(prefRes.error);
                return;
            }
            setHasKey((prev) => ({ ...prev, [provider]: true }));
            setPreferredProviderState(provider);
            setKeyInput("");
            setVerify("idle");
            setVerifyMsg(null);
            toast.success(`${providerName} key saved.`);
            onChanged?.();
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async () => {
        if (!hasKey[provider]) return;
        setRemoving(true);
        try {
            const res = await saveProviderApiKey(provider, "");
            if (res.error) {
                toast.error(res.error);
                return;
            }
            setHasKey((prev) => ({ ...prev, [provider]: false }));
            setKeyInput("");
            setVerify("idle");
            setVerifyMsg(null);
            toast.success(`${providerName} key removed.`);
            onChanged?.();
        } finally {
            setRemoving(false);
        }
    };

    if (loading) {
        return (
            <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
                <CircleNotch size={16} className="animate-spin" />
                Loading API key settings…
            </div>
        );
    }

    return (
        <div className={cn("space-y-5", className)}>
            <div className="space-y-2">
                <Label htmlFor="byok-provider">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as ByokProvider)}>
                    <SelectTrigger id="byok-provider" className="rounded-none bg-background">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                        {PROVIDERS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                {p.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <ByokOnboardingGuide
                key={`${provider}-${hasKey[provider]}`}
                provider={provider}
                providerName={providerName}
                connected={hasKey[provider]}
            />

            {hasKey[provider] && (
                <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/30 px-3 py-2.5">
                    <p className="text-[13px] text-foreground">
                        <span className="font-medium">{providerName} key connected</span>
                        {preferredProvider === provider && (
                            <span className="ml-1.5 text-muted-foreground">(active)</span>
                        )}
                    </p>
                    <button
                        type="button"
                        onClick={() => document.getElementById("byok-key")?.focus()}
                        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                        Replace
                    </button>
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor="byok-key">Paste your key</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        id="byok-key"
                        type="password"
                        autoComplete="off"
                        placeholder={hasKey[provider] ? "•••••••• (saved — paste to replace)" : KEY_PLACEHOLDERS[provider]}
                        value={keyInput}
                        onChange={(e) => {
                            setKeyInput(e.target.value);
                            setVerify("idle");
                            setVerifyMsg(null);
                        }}
                        className="rounded-none font-mono text-sm"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-none sm:shrink-0"
                        onClick={() => void handleTest()}
                        disabled={!keyInput.trim() || testing}
                    >
                        {testing ? <CircleNotch size={16} className="animate-spin" /> : "Test"}
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Keys look like {KEY_PLACEHOLDERS[provider]}
                </p>
                {verifyMsg && (
                    <p className={cn("text-xs", verify === "ok" ? "text-foreground" : "text-destructive")}>{verifyMsg}</p>
                )}
                <p className="text-xs text-muted-foreground">
                    Stored encrypted (AES-256-GCM), used only for your AI requests.
                </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground max-w-md">
                    Test before saving — we never store keys that fail verification.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    {hasKey[provider] && (
                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-none gap-1.5"
                            onClick={() => void handleRemove()}
                            disabled={removing || saving}
                        >
                            {removing ? <CircleNotch size={16} className="animate-spin" /> : <Trash size={16} />}
                            Remove key
                        </Button>
                    )}
                    <Button
                        type="button"
                        className="rounded-none"
                        onClick={() => void handleSave()}
                        disabled={!canSave || saving}
                    >
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/** Deep-link target for AI gate nudges. */
export function ByokSettingsLink({ className }: { className?: string }) {
    return (
        <Link href="/settings?tab=api-key" className={cn("text-brand underline underline-offset-2", className)}>
            Settings → API key
        </Link>
    );
}

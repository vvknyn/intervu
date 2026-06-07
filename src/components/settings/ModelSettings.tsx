"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CheckCircle, WarningCircle, CircleNotch } from "@phosphor-icons/react";
import { AVAILABLE_MODELS, PROVIDERS, type Provider } from "@/lib/llm/models";
import { fetchProfile, saveProviderApiKey, updateModelPreference } from "@/actions/profile";
import { validateProviderKey } from "@/actions/llm-settings";

const KEY_HELP: Record<Provider, { url: string }> = {
    openrouter: { url: "https://openrouter.ai/keys" },
    groq: { url: "https://console.groq.com/keys" },
};

type VerifyState = { state: "idle" | "checking" | "ok" | "fail"; msg?: string };

export function ModelSettings() {
    const [provider, setProvider] = useState<Provider>("openrouter");
    const [model, setModel] = useState<string>(AVAILABLE_MODELS.openrouter[0].id);
    const [keyInput, setKeyInput] = useState("");
    const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);
    const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
    const [saved, setSaved] = useState(false);

    // Load saved preference + which providers already have a key (presence only — never the plaintext key).
    useEffect(() => {
        (async () => {
            const { data } = await fetchProfile();
            if (!data) return;
            const present: Record<string, boolean> = {};
            const pk = data.provider_api_keys as Record<string, string> | undefined;
            if (pk) for (const k of Object.keys(pk)) if (pk[k]) present[k] = true;
            setHasKey(present);
            const p = data.preferred_provider as Provider | null;
            if (p === "openrouter" || p === "groq") {
                setProvider(p);
                setModel((data.preferred_model as string) || AVAILABLE_MODELS[p][0].id);
            }
        })();
    }, []);

    // Keep the model valid for the selected provider; reset transient input/verify state on switch.
    useEffect(() => {
        const models = AVAILABLE_MODELS[provider];
        setModel((cur) => (models.some((m) => m.id === cur) ? cur : models[0].id));
        setKeyInput("");
        setVerify({ state: "idle" });
    }, [provider]);

    const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? provider;

    const handleVerify = async () => {
        setVerify({ state: "checking" });
        const res = await validateProviderKey(provider, keyInput);
        setVerify(res.valid ? { state: "ok", msg: "Key works" } : { state: "fail", msg: res.error || "Invalid key" });
    };

    const handleSave = async () => {
        setLoading(true);
        setSaved(false);
        try {
            if (keyInput.trim()) {
                const r = await saveProviderApiKey(provider, keyInput.trim());
                if (r.error) {
                    setVerify({ state: "fail", msg: r.error });
                    return;
                }
                setHasKey((prev) => ({ ...prev, [provider]: true }));
                setKeyInput("");
            }
            await updateModelPreference(provider, model);
            setSaved(true);
            setVerify({ state: "idle" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Provider */}
            <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover">
                        {PROVIDERS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* API key */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    {providerName} API key
                    {hasKey[provider] && (
                        <span className="text-[11px] font-normal text-green-600 dark:text-green-500">✓ saved</span>
                    )}
                </Label>
                <div className="flex gap-2">
                    <Input
                        type="password"
                        placeholder={hasKey[provider] ? "•••••••• (saved — enter to replace)" : `Paste your ${providerName} key`}
                        value={keyInput}
                        onChange={(e) => { setKeyInput(e.target.value); setVerify({ state: "idle" }); setSaved(false); }}
                        className="font-mono text-sm"
                    />
                    <Button type="button" variant="outline" onClick={handleVerify} disabled={!keyInput.trim() || verify.state === "checking"}>
                        {verify.state === "checking" ? <CircleNotch size={16} className="animate-spin" /> : "Verify"}
                    </Button>
                </div>
                {verify.state === "ok" && (
                    <p className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1"><CheckCircle size={14} weight="fill" />{verify.msg}</p>
                )}
                {verify.state === "fail" && (
                    <p className="text-xs text-destructive flex items-center gap-1"><WarningCircle size={14} weight="fill" />{verify.msg}</p>
                )}
                <p className="text-xs text-muted-foreground">
                    Stored encrypted (AES-256-GCM), used only for your own requests. Get a key at{" "}
                    <a href={KEY_HELP[provider].url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                        {KEY_HELP[provider].url.replace("https://", "")}
                    </a>.
                </p>
            </div>

            {/* Model */}
            <div className="space-y-2">
                <Label>Model</Label>
                <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover">
                        {AVAILABLE_MODELS[provider].map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name} — {m.description}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground max-w-xs">
                    No key needed to start — we provide a default model. Add your own to use your preferred model and avoid shared limits.
                </p>
                <div className="flex items-center gap-3">
                    {saved && <span className="text-xs text-green-600 dark:text-green-500">Saved</span>}
                    <Button onClick={handleSave} disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
                </div>
            </div>
        </div>
    );
}

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeSlash, CheckCircle, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { SecurityBadge } from "@/components/settings/SecurityBadge";
import { CostBadge } from "@/components/settings/CostBadge";
import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/llm/models";

const PROVIDERS: { id: Provider; name: string; placeholder: string; url: string; tagline: string }[] = [
    { id: "groq", name: "Groq", placeholder: "gsk_...", url: "https://console.groq.com/keys", tagline: "Fastest, free" },
    { id: "gemini", name: "Google Gemini", placeholder: "AIza...", url: "https://aistudio.google.com/app/apikey", tagline: "Free, large context" },
    { id: "openai", name: "OpenAI", placeholder: "sk-...", url: "https://platform.openai.com/api-keys", tagline: "Most capable, paid" },
];

interface ConnectAIStepProps {
    apiKeys: { groq?: string; gemini?: string; openai?: string };
    onSave: (provider: 'groq' | 'gemini' | 'openai', key: string) => Promise<void>;
    onValidityChange?: (valid: boolean) => void;
}

export function ConnectAIStep({ apiKeys, onSave, onValidityChange }: ConnectAIStepProps) {
    const [selectedProvider, setSelectedProvider] = useState<Provider>(
        apiKeys.groq ? "groq" : apiKeys.gemini ? "gemini" : "groq"
    );
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const hasAnyKey = !!(apiKeys.groq || apiKeys.gemini || apiKeys.openai);

    useEffect(() => {
        onValidityChange?.(hasAnyKey || saved);
    }, [hasAnyKey, saved, onValidityChange]);

    const isKeyFormatValid = (key: string, provider: Provider): boolean => {
        if (!key || key.trim().length < 10) return false;
        const trimmed = key.trim();
        if (provider === "groq") return trimmed.startsWith("gsk_");
        if (provider === "gemini") return trimmed.startsWith("AIza");
        if (provider === "openai") return trimmed.startsWith("sk-");
        return true;
    };

    const handleSave = async () => {
        if (!isKeyFormatValid(apiKey, selectedProvider)) {
            const p = PROVIDERS.find(p => p.id === selectedProvider);
            setError(`Key should start with ${p?.placeholder.replace("...", "")}`);
            return;
        }
        setIsSaving(true);
        setError(null);
        try {
            await onSave(selectedProvider, apiKey.trim());
            setSaved(true);
            setApiKey("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save key");
        } finally {
            setIsSaving(false);
        }
    };

    const provider = PROVIDERS.find((p) => p.id === selectedProvider)!;

    return (
        <div className="space-y-5 animate-in fade-in">
            <p className="text-sm text-muted-foreground leading-relaxed">
                Pick a provider below, then paste your API key. Don&apos;t have one yet?
                Click &ldquo;Get your key&rdquo; &mdash; it takes about 2 minutes to sign up.
            </p>

            {(hasAnyKey || saved) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-sm">
                    <CheckCircle size={18} weight="fill" />
                    <span>AI provider connected! You can add more or continue.</span>
                </div>
            )}

            {/* Provider cards */}
            <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => {
                    const isConnected = !!apiKeys[p.id];
                    return (
                        <button
                            key={p.id}
                            onClick={() => { setSelectedProvider(p.id); setError(null); setApiKey(""); }}
                            className={cn(
                                "relative p-3 rounded-lg border text-left transition-all text-sm",
                                selectedProvider === p.id
                                    ? "border-brand bg-brand/5 shadow-sm"
                                    : "border-border/50 hover:border-border",
                            )}
                        >
                            <div className="font-medium text-xs">{p.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{p.tagline}</div>
                            <div className="mt-1.5">
                                <CostBadge provider={p.id} />
                            </div>
                            {isConnected && (
                                <CheckCircle size={14} weight="fill" className="absolute top-2 right-2 text-green-500" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Key input */}
            <div className="space-y-2">
                <Label htmlFor="setup-api-key" className="text-xs">Your {provider.name} Key</Label>
                <div className="relative">
                    <Input
                        id="setup-api-key"
                        type={showKey ? "text" : "password"}
                        placeholder={provider.placeholder}
                        value={apiKey}
                        onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        className="pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted/50 transition-colors"
                    >
                        {showKey ? (
                            <EyeSlash size={16} className="text-muted-foreground" />
                        ) : (
                            <Eye size={16} className="text-muted-foreground" />
                        )}
                    </button>
                </div>
                <Button variant="outline" size="sm" className="w-full justify-center gap-2 text-xs" asChild>
                    <a href={provider.url} target="_blank" rel="noopener noreferrer">
                        Get your key from {provider.name}
                        <ArrowSquareOut size={12} />
                    </a>
                </Button>
            </div>

            {error && (
                <Alert variant="destructive">
                    <WarningCircle size={16} />
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
            )}

            <Button
                onClick={handleSave}
                disabled={!apiKey.trim() || isSaving}
                className="w-full"
            >
                {isSaving ? "Connecting..." : "Connect"}
            </Button>

            <SecurityBadge compact />
        </div>
    );
}

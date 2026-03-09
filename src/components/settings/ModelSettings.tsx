
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

import { AVAILABLE_MODELS, PROVIDERS } from "@/lib/llm/models";

interface ModelSettingsProps {
    apiKey: string;
    model: string;
    onSave: (apiKey: string, model: string) => void;
    loading: boolean;
}

export function ModelSettings({ apiKey, model, onSave, loading }: ModelSettingsProps) {
    // State for all keys
    const [keys, setKeys] = useState<{ [key: string]: string }>({
        groq: "",
        gemini: "",
        openai: ""
    });

    // State for selection
    const [provider, setProvider] = useState<string>("groq");

    // Initialize state from props
    useEffect(() => {
        // Parse provider:model
        let initProvider = "groq";

        if (model && model.includes(':')) {
            const parts = model.split(':');
            initProvider = parts[0];
        } else if (model) {
            // Legacy fallback - unlikely to happen now but good for safety
        }

        // Avoid loop if already set
        // Wrap in timeout to avoid synchronous setState warning
        setTimeout(() => {
            if (provider !== initProvider) {
                setProvider(initProvider);
            }
        }, 0);

        // Parse API Key JSON
        try {
            if (apiKey && apiKey.trim().startsWith('{')) {
                const parsed = JSON.parse(apiKey);
                // Only update if different to avoid loop (simplified check)
                // Wrap in timeout
                setTimeout(() => {
                    setKeys(prev => ({ ...prev, ...parsed }));
                }, 0);
            } else if (apiKey) {
                setTimeout(() => {
                    setKeys(prev => ({ ...prev, groq: apiKey }));
                }, 0);
            }
        } catch (e) {
            console.error("Failed to parse API keys", e);
        }
    }, [apiKey, model]);

    const handleKeyChange = (p: string, value: string) => {
        setKeys(prev => ({ ...prev, [p]: value }));
    };

    const handleSave = () => {
        // Save composite key and composite model string
        const compositeKey = JSON.stringify(keys);

        // Auto-select the first (best) model for the selected provider
        // @ts-expect-error - Dictionary access with string key
        const bestModelId = AVAILABLE_MODELS[provider]?.[0]?.id || AVAILABLE_MODELS.groq[0].id;

        const compositeModel = `${provider}:${bestModelId}`;
        onSave(compositeKey, compositeModel);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div className="border border-border rounded-lg p-6 bg-card/50">
                <h3 className="text-base font-semibold mb-4">LLM Provider Configuration</h3>

                <div className="grid gap-6">
                    {/* Provider Select */}
                    <div className="space-y-2">
                        <Label>Select Provider</Label>
                        <Select value={provider} onValueChange={setProvider}>
                            <SelectTrigger className="bg-background">
                                <SelectValue placeholder="Select Provider" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-zinc-950">
                                {PROVIDERS.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            We automatically select the best model for your chosen provider.
                        </p>
                    </div>

                    {/* API Key Input for Selected Provider */}
                    <div className="space-y-2">
                        <Label>API Key for {PROVIDERS.find(p => p.id === provider)?.name}</Label>
                        <Input
                            type="password"
                            placeholder={`Enter your ${provider.toUpperCase()} API Key`}
                            value={keys[provider] || ""}
                            onChange={(e) => handleKeyChange(provider, e.target.value)}
                            className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                            Your key is stored securely in your database.
                            {provider === 'groq' && " Use specific Groq keys."}
                            {provider === 'gemini' && " Get a key from Google AI Studio."}
                            {provider === 'openai' && " Requires an OpenAI Platform key."}
                        </p>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <Button onClick={handleSave} disabled={loading}>
                        {loading ? "Saving..." : "Save Configuration"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

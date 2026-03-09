"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeSlash, CheckCircle, WarningCircle, CircleNotch, ArrowSquareOut, Info, Trash } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SecurityBadge } from "@/components/settings/SecurityBadge";
import { ApiKeyGuide } from "./ApiKeyGuide";

interface ApiKeyConfigModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider: 'groq' | 'gemini' | 'openai';
    currentKey?: string;
    onSave: (provider: 'groq' | 'gemini' | 'openai', key: string) => Promise<void>;
    onRemove?: (provider: 'groq' | 'gemini' | 'openai') => Promise<void>;
}

const PROVIDER_INFO = {
    groq: {
        name: "Groq",
        keyPlaceholder: "gsk_...",
        getKeyUrl: "https://console.groq.com/keys"
    },
    gemini: {
        name: "Google Gemini",
        keyPlaceholder: "AIza...",
        getKeyUrl: "https://aistudio.google.com/app/apikey"
    },
    openai: {
        name: "OpenAI",
        keyPlaceholder: "sk-...",
        getKeyUrl: "https://platform.openai.com/api-keys"
    }
};

export function ApiKeyConfigModal({ open, onOpenChange, provider, currentKey = "", onSave, onRemove }: ApiKeyConfigModalProps) {
    const [apiKey, setApiKey] = useState(currentKey);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

    const info = PROVIDER_INFO[provider];

    // Reset state when modal opens
    useEffect(() => {
        if (open) {
            setApiKey(currentKey);
            setError(null);
            setValidationStatus('idle');
        }
    }, [open, currentKey]);

    // Basic key format validation
    const isKeyFormatValid = (key: string): boolean => {
        if (!key || key.trim() === '') return false;
        const trimmedKey = key.trim();

        switch (provider) {
            case 'groq':
                return trimmedKey.startsWith('gsk_') && trimmedKey.length > 20;
            case 'gemini':
                return trimmedKey.startsWith('AIza') && trimmedKey.length > 20;
            case 'openai':
                return trimmedKey.startsWith('sk-') && trimmedKey.length > 20;
            default:
                return trimmedKey.length > 10;
        }
    };

    // Validate key format when it changes
    useEffect(() => {
        if (apiKey && apiKey.trim().length > 5) {
            if (isKeyFormatValid(apiKey)) {
                setValidationStatus('idle');
                setError(null);
            } else {
                setValidationStatus('invalid');
                setError(`Hmm, that doesn't look right. ${info.name} keys start with ${info.keyPlaceholder.replace('...', '')}.`);
            }
        } else {
            setValidationStatus('idle');
            setError(null);
        }
    }, [apiKey, provider, info.name, info.keyPlaceholder]);

    const handleSave = async () => {
        // Quick format check
        if (!isKeyFormatValid(apiKey)) {
            setError(`Please paste your ${info.name} key to continue`);
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            console.log("[ApiKeyConfigModal] Saving key for provider:", provider);
            await onSave(provider, apiKey.trim());
            console.log("[ApiKeyConfigModal] Save successful, closing modal");
            setValidationStatus('valid');
            onOpenChange(false);
        } catch (error) {
            console.error("[ApiKeyConfigModal] Save failed:", error);
            setError(error instanceof Error ? error.message : "Failed to save API key");
            setValidationStatus('invalid');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemove = async () => {
        if (!onRemove) return;
        setIsRemoving(true);
        setError(null);
        try {
            await onRemove(provider);
            onOpenChange(false);
        } catch (error) {
            console.error("[ApiKeyConfigModal] Remove failed:", error);
            setError(error instanceof Error ? error.message : "Failed to remove API key");
        } finally {
            setIsRemoving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Connect {info.name}</DialogTitle>
                    <DialogDescription>
                        Intervu is the interface — you bring the intelligence. Connect your {info.name} key to power analysis.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {provider === 'openai' && (
                        <Alert>
                            <Info size={16} className="text-muted-foreground" />
                            <AlertDescription className="text-xs">
                                Your ChatGPT Plus subscription ($20/mo) is separate from the OpenAI API. You need a developer API key. Most Intervu users spend less than $1/month.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="apiKey">Your {info.name} Key</Label>
                        <div className="relative">
                            <Input
                                id="apiKey"
                                type={showKey ? "text" : "password"}
                                placeholder={info.keyPlaceholder}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className={`pr-20 ${validationStatus === 'invalid' ? 'border-red-400 focus:border-red-500' : ''} ${validationStatus === 'valid' ? 'border-green-400 focus:border-green-500' : ''}`}
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {/* Validation indicator */}
                                {isValidating && (
                                    <CircleNotch size={16} className="text-muted-foreground animate-spin" />
                                )}
                                {!isValidating && validationStatus === 'valid' && (
                                    <CheckCircle size={16} weight="fill" className="text-green-500" />
                                )}
                                {!isValidating && validationStatus === 'invalid' && apiKey.length > 5 && (
                                    <WarningCircle size={16} weight="fill" className="text-red-500" />
                                )}
                                {/* Show/hide toggle */}
                                <button
                                    type="button"
                                    onClick={() => setShowKey(!showKey)}
                                    className="p-1.5 rounded hover:bg-muted/50 transition-colors"
                                >
                                    {showKey ? (
                                        <EyeSlash size={16} className="text-muted-foreground" />
                                    ) : (
                                        <Eye size={16} className="text-muted-foreground" />
                                    )}
                                </button>
                            </div>
                        </div>
                        {/* Format hint */}
                        {apiKey && apiKey.length > 0 && apiKey.length < 10 && (
                            <p className="text-xs text-muted-foreground">
                                Expected format: {info.keyPlaceholder}...
                            </p>
                        )}
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-center gap-2 text-sm"
                        asChild
                    >
                        <a href={info.getKeyUrl} target="_blank" rel="noopener noreferrer">
                            Get your key from {info.name}
                            <ArrowSquareOut size={14} />
                        </a>
                    </Button>

                    <SecurityBadge compact />

                    <ApiKeyGuide />
                </div>

                {error && (
                    <Alert variant="destructive">
                        <WarningCircle size={16} />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {onRemove && currentKey && (
                        <Button
                            variant="ghost"
                            onClick={handleRemove}
                            disabled={isSaving || isRemoving}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 sm:mr-auto"
                        >
                            {isRemoving ? (
                                <CircleNotch size={14} className="animate-spin mr-1.5" />
                            ) : (
                                <Trash size={14} className="mr-1.5" />
                            )}
                            {isRemoving ? "Removing..." : "Remove Key"}
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving || isRemoving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!apiKey.trim() || isSaving || isRemoving}
                    >
                        {isSaving ? "Connecting..." : "Connect"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

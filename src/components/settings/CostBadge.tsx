"use client";

import { Badge } from "@/components/ui/badge";
import { PROVIDER_TIER, estimateSessionCost } from "@/lib/llm/pricing";
import type { Provider } from "@/lib/llm/models";

interface CostBadgeProps {
    provider: Provider;
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
}

export function CostBadge({ provider, modelId, inputTokens = 0, outputTokens = 0 }: CostBadgeProps) {
    const tier = PROVIDER_TIER[provider];

    if (tier === "free") {
        return (
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/10">
                Free
            </Badge>
        );
    }

    const cost = modelId ? estimateSessionCost(modelId, inputTokens, outputTokens) : null;

    if (cost && cost > 0) {
        return (
            <Badge variant="outline">
                ~${cost.toFixed(3)} this session
            </Badge>
        );
    }

    return (
        <Badge variant="outline">
            Pay-as-you-go
        </Badge>
    );
}
